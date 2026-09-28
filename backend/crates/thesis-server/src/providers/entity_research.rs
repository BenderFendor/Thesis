mod cache;
mod http;
mod material;
mod normalize;
mod organization;
mod reporter;
mod source;
mod source_cache;

use std::sync::Arc;

use reqwest::Url;
use serde_json::Value;
use thesis_api::embedding::EmbeddingClient;
use thesis_api::entity_research::{
    EntityResearchFuture, EntityResearchProvider, EntityResearchState, JsonObject,
    MaterialContextRequest, MaterialContextResponse, OrganizationResearchRequest,
    OrganizationResearchResponse, ProviderResult, ReporterProfileRequest, ReporterProfileResponse,
    SourceResearchRequest, SourceResearchResponse,
};
use thesis_db::Database;

use crate::providers::{ChatCompletionClient, ProviderClients, SafeHttpFetcher};

use self::cache::DatabaseEntityResearchCache;

struct HttpEntityResearchProvider {
    database: Database,
    fetcher: SafeHttpFetcher,
    embedding: EmbeddingClient,
    chat: Option<ChatCompletionClient>,
}

impl EntityResearchProvider for HttpEntityResearchProvider {
    fn profile_reporter(
        &self,
        request: ReporterProfileRequest,
    ) -> EntityResearchFuture<ProviderResult<ReporterProfileResponse>> {
        let fetcher = self.fetcher.clone();
        let embedding = self.embedding.clone();
        Box::pin(async move {
            let response = reporter::research_reporter(&fetcher, &embedding, request).await;
            let provenance = response.research_sources.clone().unwrap_or_default();
            Ok(ProviderResult {
                value: response,
                provenance,
            })
        })
    }

    fn research_organization(
        &self,
        request: OrganizationResearchRequest,
    ) -> EntityResearchFuture<ProviderResult<OrganizationResearchResponse>> {
        let fetcher = self.fetcher.clone();
        Box::pin(async move {
            let facts =
                organization::research_organization(&fetcher, request.name, request.website).await;
            let provenance = facts.response.research_sources.clone().unwrap_or_default();
            Ok(ProviderResult {
                value: facts.response,
                provenance,
            })
        })
    }

    fn research_source(
        &self,
        request: SourceResearchRequest,
    ) -> EntityResearchFuture<ProviderResult<SourceResearchResponse>> {
        let fetcher = self.fetcher.clone();
        let database = self.database.clone();
        Box::pin(async move {
            let response = source::research_source(&fetcher, &database, request).await;
            let provenance = response
                .citations
                .as_ref()
                .into_iter()
                .flatten()
                .filter_map(|citation| citation.get("url").cloned())
                .collect();
            Ok(ProviderResult {
                value: response,
                provenance,
            })
        })
    }

    fn ownership_chain(
        &self,
        organization_name: String,
        max_depth: i64,
    ) -> EntityResearchFuture<ProviderResult<Vec<JsonObject>>> {
        let fetcher = self.fetcher.clone();
        Box::pin(async move {
            let mut chain = Vec::new();
            let mut current_name = organization_name;
            let mut visited = std::collections::BTreeSet::new();
            for _ in 0..max_depth {
                let key = current_name.trim().to_lowercase();
                if key.is_empty() || !visited.insert(key) {
                    break;
                }
                let facts = organization::research_organization(&fetcher, current_name, None).await;
                let parent = facts.response.parent_org.clone();
                let entry = serde_json::to_value(facts.response)
                    .expect("organization response is serializable");
                let object =
                    serde_json::from_value(entry).expect("organization response is a JSON object");
                chain.push(object);
                let Some(parent) = parent.filter(|parent| !parent.trim().is_empty()) else {
                    break;
                };
                current_name = parent;
            }
            let provenance = chain
                .iter()
                .filter_map(|entry| entry.get("research_sources"))
                .filter_map(Value::as_array)
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            Ok(ProviderResult {
                value: chain,
                provenance,
            })
        })
    }

    fn material_context(
        &self,
        request: MaterialContextRequest,
    ) -> EntityResearchFuture<ProviderResult<MaterialContextResponse>> {
        let database = self.database.clone();
        let chat = self.chat.clone();
        Box::pin(async move {
            let response = material::material_context(&database, chat.as_ref(), request).await?;
            Ok(ProviderResult {
                value: response,
                provenance: vec!["thesis_db".to_owned()],
            })
        })
    }

    fn economic_profile(
        &self,
        country_code: String,
    ) -> EntityResearchFuture<ProviderResult<JsonObject>> {
        let database = self.database.clone();
        Box::pin(async move {
            let response = material::economic_profile(&database, &country_code).await?;
            Ok(ProviderResult {
                value: response,
                provenance: vec!["thesis_db".to_owned()],
            })
        })
    }

    fn normalize_wikipedia_urls(
        &self,
        urls: Vec<Option<String>>,
    ) -> EntityResearchFuture<Vec<Option<String>>> {
        let fetcher = self.fetcher.clone();
        Box::pin(async move {
            let mut normalized = Vec::with_capacity(urls.len());
            for url in urls {
                normalized.push(match url {
                    Some(url) => Some(normalize_wikipedia_url(&fetcher, &url).await.unwrap_or(url)),
                    None => None,
                });
            }
            Ok(normalized)
        })
    }
}

pub(crate) fn entity_research_state(
    database: Database,
    clients: ProviderClients,
) -> EntityResearchState {
    let provider = HttpEntityResearchProvider {
        database: database.clone(),
        fetcher: clients.safe_http,
        embedding: clients.embedding,
        chat: clients.chat,
    };
    let cache = DatabaseEntityResearchCache::new(database);
    EntityResearchState::new(Some(Arc::new(provider)), Some(Arc::new(cache)))
}

async fn normalize_wikipedia_url(fetcher: &SafeHttpFetcher, value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    let language = host.strip_suffix(".wikipedia.org")?;
    if language.is_empty() || matches!(language, "en" | "www") || language.contains('.') {
        return Some(value.to_owned());
    }
    let mut path = url.path_segments()?;
    if path.next()? != "wiki" {
        return Some(value.to_owned());
    }
    let title = path.next()?;
    if title.is_empty() {
        return Some(value.to_owned());
    }
    let title = percent_decode_path_segment(title)?;
    let api = format!("https://{language}.wikipedia.org/w/api.php");
    let api_url = http::api_url(
        &api,
        &[
            ("action", "query"),
            ("prop", "langlinks"),
            ("lllang", "en"),
            ("titles", &title.replace('_', " ")),
            ("format", "json"),
        ],
    );
    let response = http::get_json(fetcher, &api_url).await?;
    let english_title = english_langlink_title(&response)?;
    let mut english_url = Url::parse("https://en.wikipedia.org/wiki/").ok()?;
    english_url
        .path_segments_mut()
        .ok()?
        .pop_if_empty()
        .push(&english_title.replace(' ', "_"));
    Some(english_url.to_string())
}

fn english_langlink_title(response: &Value) -> Option<&str> {
    let pages = response.get("query")?.get("pages")?;
    let page = pages
        .as_object()
        .and_then(|pages| pages.values().next())
        .or_else(|| pages.as_array().and_then(|pages| pages.first()))?;
    let english_link = page
        .get("langlinks")?
        .as_array()?
        .iter()
        .find(|link| link.get("lang").and_then(Value::as_str) == Some("en"))?;
    english_link
        .get("title")
        .or_else(|| english_link.get("*"))?
        .as_str()
}
fn percent_decode_path_segment(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push((hex_digit(high)? << 4) | hex_digit(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{english_langlink_title, hex_digit, percent_decode_path_segment};
    use serde_json::json;

    #[test]
    fn wikipedia_title_path_decoding_preserves_utf8_and_rejects_bad_escapes() {
        assert_eq!(
            percent_decode_path_segment("Fran%C3%A7ois_Dupont").as_deref(),
            Some("François_Dupont")
        );
        assert!(percent_decode_path_segment("bad%2").is_none());
        assert_eq!(hex_digit(b'F'), Some(15));
        assert_eq!(hex_digit(b'x'), None);
    }
    #[test]
    fn wikipedia_langlinks_accept_both_mediawiki_response_shapes() {
        let object_pages = json!({
            "query": {
                "pages": {
                    "1": {"langlinks": [{"lang": "en", "title": "English page"}]}
                }
            }
        });
        let array_pages = json!({
            "query": {
                "pages": [{"langlinks": [{"lang": "en", "*": "Legacy title"}]}]
            }
        });
        assert_eq!(english_langlink_title(&object_pages), Some("English page"));
        assert_eq!(english_langlink_title(&array_pages), Some("Legacy title"));
        assert_eq!(
            english_langlink_title(&json!({"query": {"pages": []}})),
            None
        );
    }
}
