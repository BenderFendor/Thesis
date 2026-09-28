use super::*;
pub(super) async fn read_limited_body(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!("response exceeded the {max_bytes}-byte limit"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(super) fn normalize_gdelt_articles(articles: &[Value], result_type: &str, limit: usize) -> Vec<Value> {
    let mut results = Vec::new();
    for article in articles.iter().take(limit) {
        let Some(url) = truthy_string(article.get("url")) else {
            continue;
        };
        let title = truthy_string(article.get("title")).unwrap_or_else(|| "Untitled".to_owned());
        let source = truthy_string(article.get("domain"))
            .or_else(|| truthy_string(article.get("source")))
            .unwrap_or_else(|| "External source".to_owned());
        let context = truthy_string(article.get("context"));
        let sentence = truthy_string(article.get("sentence"));
        let summary = if result_type == "context" {
            context
                .as_deref()
                .or(sentence.as_deref())
                .unwrap_or(&title)
                .to_owned()
        } else {
            title.clone()
        };
        let mut normalized = json!({
            "url": url,
            "link": url,
            "title": title,
            "source": source,
            "summary": summary,
            "description": summary,
            "published": article.get("seendate").cloned().unwrap_or(Value::Null),
            "image": article.get("socialimage").cloned().unwrap_or(Value::Null),
            "provider": "gdelt",
            "language": article.get("language").cloned().unwrap_or(Value::Null),
            "source_country": article.get("sourcecountry").cloned().unwrap_or(Value::Null),
            "context_snippet": context,
            "sentence": sentence,
            "tone": article.get("tone").cloned().unwrap_or(Value::Null),
            "result_type": result_type,
            "category": "external"
        });
        if let Some(object) = normalized.as_object_mut() {
            object.retain(|_, value| {
                !value.is_null() && value.as_str().map_or(true, |text| !text.is_empty())
            });
        }
        results.push(normalized);
    }
    results
}

pub(super) fn is_ddg_challenge(html: &str) -> bool {
    let lowered = html.to_lowercase();
    ["captcha", "bot challenge", "anomaly-modal", "verify you are human"]
        .iter()
        .any(|term| lowered.contains(term))
}

pub(super) fn parse_duckduckgo_results(html: &str, limit: usize, result_type: &str) -> Vec<Value> {
    let mut results = Vec::new();
    let mut cursor = 0;
    while results.len() < limit {
        let Some(relative_start) = html[cursor..].find("<a") else {
            break;
        };
        let start = cursor + relative_start;
        let Some(relative_end) = html[start..].find('>') else {
            break;
        };
        let tag_end = start + relative_end;
        let tag = &html[start..=tag_end];
        cursor = tag_end + 1;
        let class = extract_html_attribute(tag, "class").unwrap_or_default();
        if !class.split_whitespace().any(|class| class == "result__a") {
            continue;
        }
        let Some(relative_close) = html[cursor..].find("</a>") else {
            break;
        };
        let anchor_text = strip_html_tags(&html[cursor..cursor + relative_close]);
        let title = decode_html_entities(&anchor_text).trim().to_owned();
        cursor += relative_close + "</a>".len();
        let Some(href) = extract_html_attribute(tag, "href") else {
            continue;
        };
        let Some(url) = normalize_ddg_url(&href) else {
            continue;
        };
        if !url.starts_with("http://") && !url.starts_with("https://") {
            continue;
        }
        let snippet = html[cursor..]
            .find("result__snippet")
            .and_then(|position| {
                let start = cursor + position;
                let open = html[start..].find('>')? + start + 1;
                let close = html[open..].find('<')? + open;
                Some(decode_html_entities(&strip_html_tags(&html[open..close])))
            })
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty());
        let host = Url::parse(&url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_owned))
            .unwrap_or_else(|| "Web source".to_owned());
        let summary = snippet.as_deref().unwrap_or(&title);
        results.push(json!({
            "id": normalize_url(&url),
            "url": url,
            "link": url,
            "title": if title.is_empty() { "Untitled" } else { title.as_str() },
            "source": host,
            "summary": summary,
            "description": summary,
            "provider": "duckduckgo",
            "category": "external",
            "context_snippet": summary,
            "result_type": result_type
        }));
    }
    results
}

fn extract_html_attribute(tag: &str, name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() && bytes[cursor] != b'<' {
            cursor += 1;
        }
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len()
            && (bytes[cursor].is_ascii_alphanumeric() || matches!(bytes[cursor], b'-' | b'_'))
        {
            cursor += 1;
        }
        if start == cursor {
            cursor += 1;
            continue;
        }
        let attribute = &tag[start..cursor];
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let value = if cursor < bytes.len() && matches!(bytes[cursor], b'\'' | b'"') {
            let quote = bytes[cursor];
            cursor += 1;
            let start = cursor;
            while cursor < bytes.len() && bytes[cursor] != quote {
                cursor += 1;
            }
            let value = tag[start..cursor].to_owned();
            cursor = (cursor + 1).min(bytes.len());
            value
        } else {
            let start = cursor;
            while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() && bytes[cursor] != b'>' {
                cursor += 1;
            }
            tag[start..cursor].to_owned()
        };
        if attribute.eq_ignore_ascii_case(name) {
            return Some(decode_html_entities(&value));
        }
    }
    None
}

fn normalize_ddg_url(href: &str) -> Option<String> {
    let href = decode_html_entities(href);
    let parsed = Url::parse(DDG_SEARCH_URL).ok()?.join(&href).ok()?;
    if let Some(target) = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "uddg").then(|| value.into_owned()))
    {
        return Url::parse(&target).ok().map(|url| url.to_string());
    }
    Some(parsed.to_string())
}

fn strip_html_tags(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}
