const LEGAL_SUFFIXES: &[&str] = &[
    "Inc",
    "LLC",
    "Corp",
    "Corporation",
    "Company",
    "Co",
    "Ltd",
    "Limited",
];

pub(super) fn normalize_reporter_name(name: &str) -> String {
    let trimmed = name.trim();
    let without_by = trimmed
        .get(..2)
        .filter(|prefix| prefix.eq_ignore_ascii_case("by"))
        .and_then(|_| trimmed.get(2..))
        .filter(|rest| rest.chars().next().is_some_and(char::is_whitespace))
        .map(str::trim_start)
        .unwrap_or(trimmed);
    without_by.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn reporter_resolver_key(name: &str, organization: Option<&str>) -> String {
    let normalized_name = normalize_reporter_name(name).to_lowercase();
    let organization = organization.unwrap_or_default().trim().to_lowercase();
    if organization.is_empty() {
        normalized_name
    } else {
        format!("{normalized_name}::{organization}")
    }
}

pub(super) fn normalize_organization_name(name: &str) -> String {
    let mut without_legal_suffixes = String::with_capacity(name.len());
    let mut cursor = 0;

    while cursor < name.len() {
        let remainder = &name[cursor..];
        let previous_is_word = name[..cursor]
            .chars()
            .next_back()
            .is_some_and(is_word_character);
        let matched_suffix = if previous_is_word {
            None
        } else {
            LEGAL_SUFFIXES.iter().find_map(|suffix| {
                let matched = remainder.get(..suffix.len())?;
                if !matched.eq_ignore_ascii_case(suffix) {
                    return None;
                }

                let mut end = cursor + suffix.len();
                let has_word_end = name
                    .get(end..)?
                    .chars()
                    .next()
                    .is_none_or(|character| !is_word_character(character));
                if !has_word_end {
                    return None;
                }
                if name.get(end..).is_some_and(|value| value.starts_with('.')) {
                    end += 1;
                }
                Some(end)
            })
        };

        if let Some(end) = matched_suffix {
            cursor = end;
            continue;
        }

        let character = remainder
            .chars()
            .next()
            .expect("cursor is a UTF-8 character boundary");
        if matches!(character, ',' | '.' | ';' | ':') {
            without_legal_suffixes.push(' ');
        } else {
            without_legal_suffixes.push(character);
        }
        cursor += character.len_utf8();
    }

    without_legal_suffixes
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::{normalize_organization_name, normalize_reporter_name, reporter_resolver_key};

    #[test]
    fn reporter_key_uses_organization_but_not_article_context() {
        assert_eq!(
            reporter_resolver_key(" By  Jane\nDoe ", Some(" Reuters ")),
            "jane doe::reuters"
        );
        assert_eq!(reporter_resolver_key("Byron Smith", None), "byron smith");
        assert_eq!(normalize_reporter_name("by   Alex Doe"), "Alex Doe");
    }

    #[test]
    fn organization_names_remove_only_complete_legal_suffixes() {
        assert_eq!(normalize_organization_name("Reuters, Inc."), "reuters");
        assert_eq!(normalize_organization_name("News.Co"), "news");
        assert_eq!(
            normalize_organization_name("Incorporated Media"),
            "incorporated media"
        );
        assert_eq!(normalize_organization_name("ACME LLC Corp."), "acme");
    }
}
