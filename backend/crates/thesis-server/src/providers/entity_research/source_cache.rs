use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use serde_json::Value;
use thesis_api::entity_research::{
    SourceReporterSummary, SourceResearchResponse, SourceResearchValue,
};

const SOURCE_PROFILE_CACHE_SCHEMA_VERSION: u64 = 4;
const DEFAULT_SOURCE_CACHE_DIR: &str = "/tmp/thesis_source_research_cache";
const DEFAULT_SOURCE_CACHE_TTL_HOURS: i64 = 168;

#[derive(Clone, Debug)]
pub(super) struct SourceProfileFileCache {
    directory: PathBuf,
    ttl_hours: i64,
}

#[derive(Deserialize)]
struct SourceProfileWire {
    name: String,
    #[serde(default)]
    canonical_name: Option<String>,
    #[serde(default)]
    website: Option<String>,
    #[serde(default)]
    fetched_at: Option<String>,
    #[serde(default)]
    fields: BTreeMap<String, Vec<SourceValueWire>>,
    #[serde(default)]
    key_reporters: Vec<SourceReporterWire>,
    #[serde(default)]
    overview: Option<String>,
    #[serde(default)]
    match_status: Option<String>,
    #[serde(default)]
    wikipedia_url: Option<String>,
    #[serde(default)]
    wikidata_qid: Option<String>,
    #[serde(default)]
    wikidata_url: Option<String>,
    #[serde(default)]
    dossier_sections: Option<Vec<BTreeMap<String, Value>>>,
    #[serde(default)]
    citations: Option<Vec<BTreeMap<String, String>>>,
    #[serde(default)]
    search_links: Option<BTreeMap<String, String>>,
    #[serde(default)]
    match_explanation: Option<String>,
    #[serde(default)]
    policy_transparency: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    ads_txt: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    sellers_json: Option<BTreeMap<String, Value>>,
}

#[derive(Deserialize)]
struct SourceValueWire {
    #[serde(default)]
    label: Option<String>,
    value: String,
    #[serde(default)]
    sources: Option<Vec<String>>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Deserialize)]
struct SourceReporterWire {
    name: String,
    article_count: i64,
}

impl SourceProfileFileCache {
    pub(super) fn from_env() -> Self {
        Self {
            directory: env::var_os("SOURCE_RESEARCH_CACHE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_SOURCE_CACHE_DIR)),
            ttl_hours: env::var("SOURCE_RESEARCH_CACHE_TTL_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_SOURCE_CACHE_TTL_HOURS),
        }
    }

    #[cfg(test)]
    fn new(directory: PathBuf, ttl_hours: i64) -> Self {
        Self {
            directory,
            ttl_hours,
        }
    }

    pub(super) fn load(&self, source_name: &str) -> Option<SourceResearchResponse> {
        let path = self.path(source_name);
        let metadata = fs::metadata(&path).ok()?;
        if expired(metadata.modified().ok()?, self.ttl_hours) {
            return None;
        }

        let bytes = fs::read(path).ok()?;
        let value: Value = serde_json::from_slice(&bytes).ok()?;
        if value
            .get("cache_schema_version")
            .and_then(Value::as_u64)
            .unwrap_or_default()
            < SOURCE_PROFILE_CACHE_SCHEMA_VERSION
        {
            return None;
        }
        let wire: SourceProfileWire = serde_json::from_value(value).ok()?;
        Some(SourceResearchResponse {
            name: wire.name,
            canonical_name: wire.canonical_name,
            website: wire.website,
            fetched_at: wire.fetched_at,
            cached: true,
            fields: wire
                .fields
                .into_iter()
                .map(|(key, values)| {
                    (
                        key,
                        values
                            .into_iter()
                            .map(|value| SourceResearchValue {
                                label: value.label,
                                value: value.value,
                                sources: value.sources,
                                notes: value.notes,
                            })
                            .collect(),
                    )
                })
                .collect(),
            key_reporters: wire
                .key_reporters
                .into_iter()
                .map(|reporter| SourceReporterSummary {
                    name: reporter.name,
                    article_count: reporter.article_count,
                })
                .collect(),
            overview: wire.overview,
            match_status: wire.match_status,
            wikipedia_url: wire.wikipedia_url,
            wikidata_qid: wire.wikidata_qid,
            wikidata_url: wire.wikidata_url,
            dossier_sections: wire.dossier_sections,
            citations: wire.citations,
            search_links: wire.search_links,
            match_explanation: wire.match_explanation,
            policy_transparency: wire.policy_transparency,
            ads_txt: wire.ads_txt,
            sellers_json: wire.sellers_json,
        })
    }

    pub(super) fn save(&self, response: &SourceResearchResponse) {
        let Ok(mut value) = serde_json::to_value(response) else {
            return;
        };
        let Some(object) = value.as_object_mut() else {
            return;
        };
        object.insert(
            "cache_schema_version".to_owned(),
            Value::from(SOURCE_PROFILE_CACHE_SCHEMA_VERSION),
        );

        if fs::create_dir_all(&self.directory).is_err() {
            return;
        }
        let Ok(bytes) = serde_json::to_vec_pretty(&value) else {
            return;
        };
        let _ = fs::write(self.path(&response.name), bytes);
    }

    fn path(&self, source_name: &str) -> PathBuf {
        self.directory
            .join(format!("{}.json", slugify(source_name)))
    }
}

fn slugify(value: &str) -> String {
    let mut slug = String::with_capacity(value.len());
    let mut separator = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character);
            separator = false;
        } else {
            separator = true;
        }
    }
    if slug.is_empty() {
        "unknown".to_owned()
    } else {
        slug
    }
}

fn expired(modified: SystemTime, ttl_hours: i64) -> bool {
    if ttl_hours < 0 {
        return true;
    }
    let Ok(age) = SystemTime::now().duration_since(modified) else {
        return false;
    };
    let ttl_seconds = (ttl_hours as u64).saturating_mul(60 * 60);
    age > Duration::from_secs(ttl_seconds)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};

    use serde_json::json;
    use std::collections::BTreeMap;

    use super::{expired, slugify, SourceProfileFileCache};
    use thesis_api::entity_research::SourceResearchResponse;

    #[test]
    fn cache_uses_the_existing_ascii_slug_and_schema_version() {
        assert_eq!(slugify("  Reuters & Co.  "), "reuters-co");
        assert_eq!(slugify("!!!"), "unknown");

        let directory = temp_cache_dir();
        let cache = SourceProfileFileCache::new(directory.clone(), 168);
        let response = source_response("Reuters");
        cache.save(&response);
        let cached = cache.load("reuters").expect("schema-4 cache should load");
        assert!(cached.cached);
        assert_eq!(cached.name, "Reuters");

        let path = directory.join("reuters.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("saved cache")).expect("JSON");
        value["cache_schema_version"] = json!(3);
        fs::write(&path, serde_json::to_vec(&value).expect("JSON bytes")).expect("rewrite");
        assert!(cache.load("Reuters").is_none());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn cache_expiry_preserves_recent_files_and_expires_old_ones() {
        let now = SystemTime::now();
        assert!(!expired(now, 168));
        assert!(expired(now - Duration::from_secs(169 * 60 * 60), 168));
        assert!(expired(now, -1));
    }
    fn source_response(name: &str) -> SourceResearchResponse {
        SourceResearchResponse {
            name: name.to_owned(),
            canonical_name: None,
            website: None,
            fetched_at: Some("2026-09-01T00:00:00+00:00".to_owned()),
            cached: false,
            fields: BTreeMap::new(),
            key_reporters: Vec::new(),
            overview: None,
            match_status: None,
            wikipedia_url: None,
            wikidata_qid: None,
            wikidata_url: None,
            dossier_sections: None,
            citations: None,
            search_links: None,
            match_explanation: None,
            policy_transparency: None,
            ads_txt: None,
            sellers_json: None,
        }
    }

    fn temp_cache_dir() -> PathBuf {
        let unique = format!(
            "thesis-source-profile-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }
}
