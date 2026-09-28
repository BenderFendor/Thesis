use std::collections::HashMap;

const CAMEO_ROOT_LABELS: [(&str, &str); 20] = [
    ("01", "Public statement"),
    ("02", "Appeal"),
    ("03", "Intent to cooperate"),
    ("04", "Consultation"),
    ("05", "Diplomatic engagement"),
    ("06", "Material cooperation"),
    ("07", "Aid"),
    ("08", "Yield"),
    ("09", "Investigate"),
    ("10", "Demand"),
    ("11", "Disapprove"),
    ("12", "Reject"),
    ("13", "Threaten"),
    ("14", "Protest"),
    ("15", "Exhibit force"),
    ("16", "Reduce relations"),
    ("17", "Coerce"),
    ("18", "Assault"),
    ("19", "Fight"),
    ("20", "Use unconventional violence"),
];

/// Coarse direction of a GDELT Goldstein scale value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoldsteinBucket {
    /// Value is at least 4.0.
    Cooperation,
    /// Value is at most -4.0.
    Conflict,
    /// Value falls between the cooperation and conflict thresholds.
    Mixed,
}

impl GoldsteinBucket {
    /// Returns the stable API label for this bucket.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cooperation => "cooperation",
            Self::Conflict => "conflict",
            Self::Mixed => "mixed",
        }
    }
}

/// A CAMEO root code and its count in a GDELT event set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DominantCameoRoot {
    /// Two-character normalized CAMEO root code.
    pub code: String,
    /// Human-readable label, if the code is in the known root table.
    pub label: Option<String>,
    /// Number of events with this normalized root code.
    pub count: usize,
}

#[derive(Debug)]
struct RootCount {
    code: String,
    count: usize,
    first_seen: usize,
}

/// Extracts the first two ASCII digits and pads a one-digit root with zero.
pub fn normalize_cameo_root_code(code: Option<&str>) -> Option<String> {
    let [first, second] = first_two_ascii_digits(code?.as_bytes())?;
    Some(format!("{}{}", char::from(first), char::from(second)))
}

/// Returns the first two ASCII digits, left-padding a single digit with zero.
fn first_two_ascii_digits(input: &[u8]) -> Option<[u8; 2]> {
    let mut first = None;
    for byte in input.iter().copied().filter(u8::is_ascii_digit) {
        match first {
            None => first = Some(byte),
            Some(first) => return Some([first, byte]),
        }
    }
    first.map(|first| [b'0', first])
}

/// Returns the label for a normalized CAMEO root code, if it is known.
pub fn cameo_root_label(code: Option<&str>) -> Option<&'static str> {
    let normalized = normalize_cameo_root_code(code)?;
    CAMEO_ROOT_LABELS
        .iter()
        .find_map(|(root, label)| (*root == normalized).then_some(*label))
}

/// Classifies a Goldstein value using the existing +/-4.0 cutoffs.
pub fn goldstein_bucket(value: Option<f64>) -> Option<GoldsteinBucket> {
    value.map(|value| {
        if value >= 4.0 {
            GoldsteinBucket::Cooperation
        } else if value <= -4.0 {
            GoldsteinBucket::Conflict
        } else {
            GoldsteinBucket::Mixed
        }
    })
}

/// Counts normalized CAMEO roots, ordering ties by first occurrence.
pub fn dominant_cameo_roots(codes: &[Option<String>], limit: usize) -> Vec<DominantCameoRoot> {
    let mut positions = HashMap::<String, usize>::new();
    let mut counts = Vec::<RootCount>::new();

    for (first_seen, code) in codes.iter().enumerate() {
        let Some(normalized) = normalize_cameo_root_code(code.as_deref()) else {
            continue;
        };
        if let Some(&position) = positions.get(&normalized) {
            counts[position].count += 1;
        } else {
            positions.insert(normalized.clone(), counts.len());
            counts.push(RootCount {
                code: normalized,
                count: 1,
                first_seen,
            });
        }
    }

    counts.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.first_seen.cmp(&right.first_seen))
    });
    counts.truncate(limit);
    counts
        .into_iter()
        .map(|root| DominantCameoRoot {
            label: cameo_root_label(Some(&root.code)).map(str::to_owned),
            code: root.code,
            count: root.count,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        cameo_root_label, dominant_cameo_roots, goldstein_bucket, normalize_cameo_root_code,
        GoldsteinBucket,
    };

    #[test]
    fn root_normalization_keeps_the_first_two_ascii_digits() {
        assert_eq!(
            normalize_cameo_root_code(Some("CAMEO 14.1")),
            Some("14".into())
        );
        assert_eq!(normalize_cameo_root_code(Some("3")), Some("03".into()));
        assert_eq!(normalize_cameo_root_code(Some("")), None);
        assert_eq!(normalize_cameo_root_code(Some("١٤")), None);
        assert_eq!(normalize_cameo_root_code(None), None);
    }

    #[test]
    fn labels_and_goldstein_thresholds_match_the_reference_table() {
        assert_eq!(cameo_root_label(Some("01")), Some("Public statement"));
        assert_eq!(
            cameo_root_label(Some("20")),
            Some("Use unconventional violence")
        );
        assert_eq!(cameo_root_label(Some("99")), None);
        assert_eq!(goldstein_bucket(None), None);
        assert_eq!(
            goldstein_bucket(Some(-4.0)),
            Some(GoldsteinBucket::Conflict)
        );
        assert_eq!(goldstein_bucket(Some(0.0)), Some(GoldsteinBucket::Mixed));
        assert_eq!(
            goldstein_bucket(Some(4.0)),
            Some(GoldsteinBucket::Cooperation)
        );
        assert_eq!(
            goldstein_bucket(Some(f64::NAN)),
            Some(GoldsteinBucket::Mixed)
        );
    }

    #[test]
    fn dominant_roots_keep_first_seen_order_for_ties() {
        let roots = vec![
            Some("14".into()),
            Some("03".into()),
            Some("14.2".into()),
            None,
            Some("05".into()),
            Some("03".into()),
        ];
        let result = dominant_cameo_roots(&roots, 3);
        assert_eq!(
            result
                .iter()
                .map(|root| (root.code.as_str(), root.label.as_deref(), root.count))
                .collect::<Vec<_>>(),
            vec![
                ("14", Some("Protest"), 2),
                ("03", Some("Intent to cooperate"), 2),
                ("05", Some("Diplomatic engagement"), 1),
            ]
        );
        assert!(dominant_cameo_roots(&roots, 0).is_empty());
    }
}

#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;

    use super::{dominant_cameo_roots, normalize_cameo_root_code};

    proptest! {
        #[test]
        fn root_normalization_is_idempotent(code in "[0-9A-Za-z .-]{0,64}") {
            let normalized = normalize_cameo_root_code(Some(&code));
            let normalized_again = normalize_cameo_root_code(normalized.as_deref());
            prop_assert_eq!(
                normalized_again.as_ref(),
                normalized.as_ref()
            );
            if let Some(code) = normalized {
                prop_assert_eq!(code.len(), 2);
                prop_assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
            }
        }

        #[test]
        fn dominant_roots_respect_limit_and_descending_counts(
            codes in prop::collection::vec(prop::option::of("[0-9]{1,4}"), 0..80),
            limit in 0usize..12,
        ) {
            let roots = dominant_cameo_roots(&codes, limit);
            prop_assert!(roots.len() <= limit);
            for pair in roots.windows(2) {
                prop_assert!(pair[0].count >= pair[1].count);
            }
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::{first_two_ascii_digits, goldstein_bucket, GoldsteinBucket};

    fn reference_first_two_ascii_digits(input: &[u8]) -> Option<[u8; 2]> {
        let first_index = input.iter().position(u8::is_ascii_digit)?;
        let first = input[first_index];
        let second = input
            .iter()
            .enumerate()
            .skip(first_index + 1)
            .find_map(|(_, byte)| byte.is_ascii_digit().then_some(*byte));
        Some(match second {
            Some(second) => [first, second],
            None => [b'0', first],
        })
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn first_two_digit_normalization_matches_the_stream_reference() {
        let input = kani::any::<[u8; 4]>();
        let actual = first_two_ascii_digits(&input);
        let expected = reference_first_two_ascii_digits(&input);
        assert_eq!(actual, expected);

        assert_eq!(first_two_ascii_digits(b"x1y4"), Some([b'1', b'4']));
        assert_eq!(first_two_ascii_digits(b"x7"), Some([b'0', b'7']));
        assert_eq!(first_two_ascii_digits(b"xy"), None);

        if let Some([first, second]) = actual {
            assert!(first.is_ascii_digit());
            assert!(second.is_ascii_digit());
        }
    }

    #[kani::proof]
    fn goldstein_bucket_matches_the_threshold_predicates() {
        let value = kani::any::<f64>();
        let bucket = goldstein_bucket(Some(value));
        assert_eq!(value >= 4.0, bucket == Some(GoldsteinBucket::Cooperation));
        assert_eq!(value <= -4.0, bucket == Some(GoldsteinBucket::Conflict));
        assert_eq!(
            !(value >= 4.0) && !(value <= -4.0),
            bucket == Some(GoldsteinBucket::Mixed)
        );

        assert_eq!(goldstein_bucket(None), None);
    }
}
