//! Host normalization and source-host identity matching.

const HOST_FAMILIES: &[&[&str]] = &[
    &["asiaplustj.info", "asiaplus.news", "old.asiaplustj.info"],
    &["bbc.com", "bbc.co.uk", "bbci.co.uk"],
];

/// Trim whitespace, lowercase a host, and remove every `www.` substring.
pub fn normalize_host(host: &str) -> String {
    host.trim_matches(|character: char| {
        character.is_whitespace() || matches!(character, '\u{001C}'..='\u{001F}')
    })
    .to_lowercase()
    .replace("www.", "")
}

fn is_host_or_subdomain(host: &str, domain: &str) -> bool {
    host == domain || has_label_boundary_suffix(host.as_bytes(), domain.as_bytes())
}

fn has_label_boundary_suffix(host: &[u8], domain: &[u8]) -> bool {
    host.strip_suffix(domain)
        .is_some_and(|prefix| prefix.ends_with(b"."))
}

fn belongs_to_family(host: &str, family: &[&str]) -> bool {
    family
        .iter()
        .any(|member| is_host_or_subdomain(host, member))
}

/// Return whether two normalized hosts identify the same site or known source.
///
/// A host matches its parent domain, a subdomain, or a configured BBC/Asia
/// Plus family member. Suffix lookalikes without a label boundary do not match.
pub fn hosts_match(expected: &str, actual: &str) -> bool {
    let expected = normalize_host(expected);
    let actual = normalize_host(actual);
    if expected.is_empty() || actual.is_empty() {
        return false;
    }
    if is_host_or_subdomain(&expected, &actual) || is_host_or_subdomain(&actual, &expected) {
        return true;
    }

    HOST_FAMILIES
        .iter()
        .any(|family| belongs_to_family(&expected, family) && belongs_to_family(&actual, family))
}

#[cfg(test)]
mod tests {
    use super::{hosts_match, normalize_host};

    #[test]
    fn matches_parent_subdomain_and_known_families() {
        assert!(hosts_match("www.news.example.com", "example.com"));
        assert!(hosts_match("example.com", "news.example.com"));
        assert!(hosts_match("bbci.co.uk", "bbc.com"));
        assert!(hosts_match("old.asiaplustj.info", "asiaplus.news"));
    }

    #[test]
    fn rejects_suffix_lookalikes_and_empty_hosts() {
        assert!(!hosts_match("notbbc.com", "bbc.com"));
        assert!(!hosts_match("bbc.com.example", "bbc.com"));
        assert!(!hosts_match("", "bbc.com"));
        assert!(!hosts_match("", "example.com."));
        assert!(!hosts_match("example.com.", ""));
        assert!(!hosts_match(" ", ""));
    }

    #[test]
    fn normalization_preserves_the_python_boundary_behavior() {
        assert_eq!(normalize_host("  WWW.Example.www.com  "), "example.com");
        assert_eq!(normalize_host("\u{001F}"), "");
    }
}

#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;

    use super::{hosts_match, normalize_host};

    proptest! {
        #[test]
        fn host_normalization_is_idempotent(host in "[A-Za-z0-9.-_ \\t]{0,100}") {
            let normalized = normalize_host(&host);
            prop_assert_eq!(normalize_host(&normalized), normalized);
        }

        #[test]
        fn matching_is_symmetric(
            expected in "[A-Za-z0-9.-_ \\t]{0,100}",
            actual in "[A-Za-z0-9.-_ \\t]{0,100}",
        ) {
            prop_assert_eq!(hosts_match(&expected, &actual), hosts_match(&actual, &expected));
        }

        #[test]
        fn adding_a_subdomain_label_preserves_identity(
            root in "[a-z0-9-]{1,12}\\.[a-z]{2,8}",
            label in "[a-z0-9-]{1,12}",
        ) {
            let subdomain = format!("{label}.{root}");
            prop_assert!(hosts_match(&root, &subdomain));
            prop_assert!(hosts_match(&subdomain, &root));
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::has_label_boundary_suffix;

    #[kani::proof]
    fn suffix_matches_only_after_a_label_separator() {
        let host = kani::any::<[u8; 4]>();
        let suffix = [host[2], host[3]];

        assert_eq!(has_label_boundary_suffix(&host, &suffix), host[1] == b'.');
    }
}
