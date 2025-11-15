use once_cell::sync::Lazy;
use regex::Regex;

static HTML_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
static WHITESPACE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());
static NBSP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\u{00A0}\u{2009}\u{202F}]").unwrap());

pub fn clean_html(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    let decoded = html_escape::decode_html_entities(input);
    let without_tags = HTML_TAG_RE.replace_all(&decoded, " ");
    let without_nbsp = NBSP_RE.replace_all(&without_tags, " ");
    let compact = WHITESPACE_RE.replace_all(&without_nbsp, " ");
    compact.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::clean_html;

    #[test]
    fn cleans_html_entities() {
        let output = clean_html("<p>Hello&nbsp;<strong>World</strong></p>");
        assert_eq!(output, "Hello World");
    }
}
