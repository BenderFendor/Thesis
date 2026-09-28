use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::CONTENT_TYPE;
use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode, Url};
use serde_json::Value;
use thesis_api::chroma::{ChromaInclude, ChromaQueryRequest};
use thesis_api::verification::{
    is_domain_allowed, ConfidenceLevel, VerificationCache, VerificationConfig,
    VerificationFuture, VerificationProvider, VerificationRequest, VerificationResult,
    VerificationSourceInfo, VerificationSourceType, VerificationState, VerificationWorkspaceCleaner,
    VerifiedClaim,
};
use thesis_db::{sha256_hex, verification_claim_hash, Database};
use tokio::sync::OnceCell;
use tokio::time::{self, Instant};
use tracing::warn;

use super::ProviderClients;

const DDG_SEARCH_URL: &str = "https://html.duckduckgo.com/html/";
const SERVICE_USER_AGENT: &str = "ThesisRustShadow/0.1";
const DDG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const DDG_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_DDG_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const INTERNAL_SEARCH_LIMIT: usize = 5;
const MIN_CLAIM_BUDGET: Duration = Duration::from_millis(500);
const DEFAULT_WORKSPACE_DIR: &str = "/tmp/thesis_verification";

fn new_ddg_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .connect_timeout(DDG_CONNECT_TIMEOUT)
        .timeout(DDG_REQUEST_TIMEOUT)
        .redirect(Policy::none())
        .user_agent(SERVICE_USER_AGENT)
        .build()
}
/// Build the live verification state used by the Rust server composition layer.
///
/// Search uses a dedicated no-redirect client for the fixed DDG POST endpoint;
/// Chroma and embeddings keep their process-shared typed clients.
pub(crate) fn build_verification_state(
    database: Database,
    clients: &ProviderClients,
) -> VerificationState {
    let config = VerificationConfig::from_environment();
    let cache = Arc::new(DatabaseVerificationCache {
        database: database.clone(),
    });
    let workspace_cleaner = Arc::new(LocalVerificationWorkspaceCleaner::from_environment());
    let provider = match VerificationHttpProvider::new(
        database,
        clients.chroma.clone(),
        clients.embedding.clone(),
    ) {
        Ok(provider) => Some(Arc::new(provider) as Arc<dyn VerificationProvider>),
        Err(error) => {
            warn!(%error, "verification provider could not initialize its DDG client");
            None
        }
    };

    VerificationState::with_adapters(
        config,
        provider,
        Some(cache),
        Some(workspace_cleaner),
    )
}

#[derive(Clone)]
pub(crate) struct VerificationHttpProvider {
    database: Database,
    ddg_http: Client,
    chroma: thesis_api::chroma::ChromaClient,
    embedding: thesis_api::embedding::EmbeddingClient,
    source_credibility: Arc<OnceCell<HashMap<String, SourceScore>>>,
}

impl VerificationHttpProvider {
    fn new(
        database: Database,
        chroma: thesis_api::chroma::ChromaClient,
        embedding: thesis_api::embedding::EmbeddingClient,
    ) -> Result<Self, reqwest::Error> {
        let ddg_http = new_ddg_client()?;

        Ok(Self {
            database,
            ddg_http,
            chroma,
            embedding,
            source_credibility: Arc::new(OnceCell::new()),
        })
    }

    async fn verify_request(
        &self,
        request: VerificationRequest,
        config: VerificationConfig,
    ) -> VerificationResult {
        let started = Instant::now();
        let duration = Duration::from_secs(
            u64::try_from(config.max_duration_seconds.max(0)).unwrap_or(u64::MAX),
        );
        let deadline = started + duration;
        let answer = request.main_answer.as_deref().unwrap_or_default();
        let candidate_claims = extract_claims(answer, nonnegative_limit(config.max_claims));
        let mut verified_claims = Vec::with_capacity(candidate_claims.len());
        let mut sources = BTreeMap::new();
        let mut footnote_counter = 0usize;

        for claim_text in candidate_claims {
            if deadline.saturating_duration_since(Instant::now()) < MIN_CLAIM_BUDGET {
                break;
            }
            let outcome = match time::timeout_at(
                deadline,
                self.verify_claim(claim_text, config.clone()),
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(_) => break,
            };
            let source_count = outcome.sources.len();
            let mut claim = outcome.claim;
            if outcome.cache_hit {
                claim.footnotes = (1..=source_count)
                    .map(|footnote| Value::from(u64::try_from(footnote).unwrap_or(u64::MAX)))
                    .collect();
                footnote_counter = footnote_counter.saturating_add(source_count);
            } else {
                claim.footnotes = (0..source_count)
                    .map(|_| {
                        footnote_counter = footnote_counter.saturating_add(1);
                        Value::from(u64::try_from(footnote_counter).unwrap_or(u64::MAX))
                    })
                    .collect();
            }
            for source in outcome.sources {
                sources.insert(source.id.clone(), source);
            }
            verified_claims.push(claim);
        }

        let overall_confidence = calculate_overall_confidence(&verified_claims);
        let markdown_report = format_markdown_report(
            &verified_claims,
            &sources,
            overall_confidence,
        );
        VerificationResult {
            query: request.query,
            overall_confidence,
            overall_confidence_level: confidence_level(overall_confidence),
            verified_claims,
            sources,
            markdown_report,
            generated_at: iso8601_now(),
            duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
            error: None,
        }
    }

    async fn verify_claim(
        &self,
        claim_text: String,
        config: VerificationConfig,
    ) -> ClaimOutcome {
        let claim_hash = verification_claim_hash(&claim_text);
        if let Some(outcome) = self.cached_claim(&claim_hash, &config).await {
            return outcome;
        }

        let sources = self.search_sources(&claim_text, &config).await;
        let claim = if sources.is_empty() {
            claim_without_sources(claim_hash, claim_text)
        } else {
            claim_with_sources(
                claim_hash,
                claim_text,
                &sources,
                config.recheck_threshold,
            )
        };
        self.cache_claim(&claim, &sources, config.cache_ttl_hours)
            .await;
        ClaimOutcome {
            claim,
            sources,
            cache_hit: false,
        }
    }

    async fn cached_claim(
        &self,
        claim_hash: &str,
        config: &VerificationConfig,
    ) -> Option<ClaimOutcome> {
        let cached = match self.database.get_verification_cache_now(claim_hash).await {
            Ok(cached) => cached?,
            Err(error) => {
                warn!(%error, "verification cache lookup failed");
                return None;
            }
        };
        cached_claim_outcome(cached, config)
    }

    async fn cache_claim(
        &self,
        claim: &VerifiedClaim,
        sources: &[VerificationSourceInfo],
        ttl_hours: i64,
    ) {
        let sources_json = match serde_json::to_value(sources) {
            Ok(value) => value,
            Err(error) => {
                warn!(%error, "verification sources could not be serialized for cache");
                return;
            }
        };
        if let Err(error) = self
            .database
            .upsert_verification_cache_ttl(
                &claim.id,
                &claim.claim_text,
                claim.confidence,
                confidence_level_name(claim.confidence_level),
                Some(sources_json),
                ttl_hours,
            )
            .await
        {
            warn!(%error, "verification cache write failed");
        }
    }

    async fn search_sources(
        &self,
        claim_text: &str,
        config: &VerificationConfig,
    ) -> Vec<VerificationSourceInfo> {
        let max_sources = nonnegative_limit(config.max_sources_per_claim);
        if max_sources == 0 {
            return Vec::new();
        }

        let mut sources = self.search_internal_sources(claim_text).await;
        sources.truncate(max_sources);
        let mut seen_urls: HashSet<String> =
            sources.iter().map(|source| source.url.clone()).collect();
        if sources.len() < max_sources && !config.allowed_domains.is_empty() {
            let remaining = max_sources - sources.len();
            let external = self
                .search_external_sources(claim_text, remaining, &config.allowed_domains)
                .await;
            for source in external {
                if sources.len() == max_sources {
                    break;
                }
                if seen_urls.insert(source.url.clone()) {
                    sources.push(source);
                }
            }
        }
        sources
    }

    async fn search_internal_sources(&self, claim_text: &str) -> Vec<VerificationSourceInfo> {
        let keyword_articles = match self
            .database
            .search_news_articles_by_keyword(claim_text, INTERNAL_SEARCH_LIMIT as i64)
            .await
        {
            Ok(articles) => articles,
            Err(error) => {
                warn!(%error, "verification keyword search failed");
                Vec::new()
            }
        };

        let mut sources = Vec::with_capacity(INTERNAL_SEARCH_LIMIT * 2);
        let mut seen_article_ids = HashSet::new();
        let mut seen_urls = HashSet::new();
        for article in keyword_articles {
            if article.url.trim().is_empty() {
                continue;
            }
            seen_article_ids.insert(article.id);
            if let Some(source) = self.article_source(&article, 0.7).await {
                push_unique_source(&mut sources, &mut seen_urls, source, usize::MAX);
            }
        }

        let vector_results = self.vector_search(claim_text).await;
        let vector_ids: Vec<i64> = vector_results
            .iter()
            .map(|(article_id, _)| *article_id)
            .filter(|article_id| !seen_article_ids.contains(article_id))
            .collect();
        if vector_ids.is_empty() {
            return sources;
        }

        let vector_articles = match self.database.load_news_articles_by_ids(&vector_ids).await {
            Ok(articles) => articles,
            Err(error) => {
                warn!(%error, "verification vector article lookup failed");
                return sources;
            }
        };
        let articles_by_id: HashMap<i64, _> = vector_articles
            .into_iter()
            .map(|article| (article.id, article))
            .collect();
        for (article_id, similarity) in vector_results {
            if seen_article_ids.contains(&article_id) {
                continue;
            }
            let Some(article) = articles_by_id.get(&article_id) else {
                continue;
            };
            if article.url.trim().is_empty() {
                continue;
            }
            seen_article_ids.insert(article_id);
            if let Some(source) = self.article_source(article, similarity).await {
                push_unique_source(&mut sources, &mut seen_urls, source, usize::MAX);
            }
        }
        sources
    }

    async fn vector_search(&self, claim_text: &str) -> Vec<(i64, f64)> {
        let texts = [claim_text.to_owned()];
        let embedded = match self.embedding.embed(&texts, 1).await {
            Ok(response) => response,
            Err(error) => {
                warn!(%error, "verification embedding search failed");
                return Vec::new();
            }
        };
        let Some(query_embedding) = embedded.embeddings.into_iter().next() else {
            return Vec::new();
        };
        let collection = match self.chroma.get_collection().await {
            Ok(collection) => collection,
            Err(error) => {
                warn!(%error, "verification Chroma collection lookup failed");
                return Vec::new();
            }
        };
        let response = match collection
            .query(ChromaQueryRequest {
                query_embeddings: vec![query_embedding],
                n_results: INTERNAL_SEARCH_LIMIT,
                where_filter: None,
                where_document: None,
                include: vec![ChromaInclude::Distances],
            })
            .await
        {
            Ok(response) => response,
            Err(error) => {
                warn!(%error, "verification Chroma vector search failed");
                return Vec::new();
            }
        };

        let ids = response.ids.first().map(Vec::as_slice).unwrap_or_default();
        let distances = response
            .distances
            .as_ref()
            .and_then(|rows| rows.first())
            .map(Vec::as_slice)
            .unwrap_or_default();
        ids.iter()
            .enumerate()
            .filter_map(|(index, chroma_id)| {
                let article_id = chroma_id.strip_prefix("article_")?.parse::<i64>().ok()?;
                let distance = distances.get(index).copied().unwrap_or(0.5);
                let similarity = if distance.is_finite() {
                    1.0 - distance
                } else {
                    0.5
                };
                Some((article_id, similarity))
            })
            .collect()
    }

    async fn article_source(
        &self,
        article: &thesis_db::SearchArticleRecord,
        similarity_score: f64,
    ) -> Option<VerificationSourceInfo> {
        let (url, domain) = parse_http_url(&article.url)?;
        let (stored_score, source_type) = self.source_score(&domain).await;
        let similarity_floor = 0.6 + similarity_score * 0.2;
        let credibility_score = stored_score.max(similarity_floor).clamp(0.0, 1.0);
        Some(VerificationSourceInfo {
            id: format!("internal_{}", article.id),
            url,
            title: Some(article.title.clone()),
            domain,
            credibility_score,
            source_type,
            published_at: Some(article.published_at.to_string().replace(' ', "T")),
            supports_claim: true,
            excerpt: Some(truncate_chars(
                article.summary.as_deref().unwrap_or_default(),
                200,
            )),
        })
    }

    async fn source_score(&self, domain: &str) -> (f64, VerificationSourceType) {
        let records = self
            .source_credibility
            .get_or_try_init(|| async {
                self.database
                    .list_active_source_credibility()
                    .await
                    .map(|rows| {
                        rows.into_iter()
                            .map(|row| {
                                (
                                    normalize_domain(&row.domain),
                                    SourceScore {
                                        credibility: normalized_score(row.credibility_score, 0.3),
                                        source_type: parse_source_type(row.source_type.as_deref()),
                                    },
                                )
                            })
                            .collect()
                    })
            })
            .await;
        let records = match records {
            Ok(records) => records,
            Err(error) => {
                warn!(%error, "verification source credibility lookup failed");
                return (0.3, VerificationSourceType::Unknown);
            }
        };

        let domain = normalize_domain(domain);
        if let Some(score) = records.get(&domain) {
            return (score.credibility, score.source_type);
        }
        let labels: Vec<&str> = domain.split('.').collect();
        for index in 1..labels.len().saturating_sub(1) {
            let parent = labels[index..].join(".");
            if let Some(score) = records.get(&parent) {
                return (score.credibility, score.source_type);
            }
        }
        (0.3, VerificationSourceType::Unknown)
    }

    async fn search_external_sources(
        &self,
        claim_text: &str,
        max_sources: usize,
        allowed_domains: &[String],
    ) -> Vec<VerificationSourceInfo> {
        if max_sources == 0 || allowed_domains.is_empty() {
            return Vec::new();
        }
        let query = claim_text
            .split_whitespace()
            .take(12)
            .collect::<Vec<_>>()
            .join(" ");
        let max_results = max_sources.saturating_mul(2);
        let results = match ddg_post(&self.ddg_http, DDG_SEARCH_URL, &query, max_results).await {
            Ok(results) => results,
            Err(error) => {
                warn!(%error, "DuckDuckGo verification search failed");
                return Vec::new();
            }
        };

        let mut sources = Vec::with_capacity(max_sources);
        let mut seen_urls = HashSet::new();
        for result in results {
            let Some((url, domain)) = allowlisted_search_url(&result.href, allowed_domains) else {
                continue;
            };
            let source_id = sha256_hex(url.as_bytes());
            let (credibility_score, source_type) = self.source_score(&domain).await;
            let source = VerificationSourceInfo {
                id: source_id[..12].to_owned(),
                url,
                title: Some(result.title),
                domain,
                credibility_score,
                source_type,
                published_at: None,
                supports_claim: true,
                excerpt: Some(truncate_chars(&result.excerpt, 200)),
            };
            push_unique_source(&mut sources, &mut seen_urls, source, max_sources);
            if sources.len() == max_sources {
                break;
            }
        }
        sources
    }
}

impl VerificationProvider for VerificationHttpProvider {
    fn verify(
        &self,
        request: VerificationRequest,
        config: VerificationConfig,
    ) -> VerificationFuture<VerificationResult> {
        let provider = self.clone();
        Box::pin(async move { Ok(provider.verify_request(request, config).await) })
    }
}


#[derive(Clone, Copy)]
struct SourceScore {
    credibility: f64,
    source_type: VerificationSourceType,
}

struct ClaimOutcome {
    claim: VerifiedClaim,
    sources: Vec<VerificationSourceInfo>,
    cache_hit: bool,
}

struct DdgSearchResult {
    title: String,
    href: String,
    excerpt: String,
}

struct DatabaseVerificationCache {
    database: Database,
}

impl VerificationCache for DatabaseVerificationCache {
    fn clear_expired(&self) -> VerificationFuture<usize> {
        let database = self.database.clone();
        Box::pin(async move {
            match database.clear_expired_verification_cache_now().await {
                Ok(deleted) => Ok(usize::try_from(deleted).unwrap_or(usize::MAX)),
                Err(error) => Err(error.to_string()),
            }
        })
    }
}

struct LocalVerificationWorkspaceCleaner {
    root: PathBuf,
}

impl LocalVerificationWorkspaceCleaner {
    fn from_environment() -> Self {
        let root = env::var("VERIFICATION_WORKSPACE_DIR")
            .ok()
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_WORKSPACE_DIR));
        Self { root }
    }

}

impl VerificationWorkspaceCleaner for LocalVerificationWorkspaceCleaner {
    fn schedule_stale_cleanup(&self, max_age_hours: i64) {
        let root = self.root.clone();
        drop(tokio::task::spawn_blocking(move || {
            cleanup_stale_workspaces(&root, max_age_hours)
        }));
    }
}

fn cleanup_stale_workspaces(root: &Path, max_age_hours: i64) -> usize {
    if max_age_hours < 0 {
        return 0;
    }
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return 0,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 0,
        Err(error) => {
            warn!(%error, "verification workspace root could not be inspected");
            return 0;
        }
    }

    let now = SystemTime::now();
    let age_seconds = u64::try_from(max_age_hours)
        .unwrap_or(u64::MAX)
        .saturating_mul(60 * 60);
    let cutoff = now
        .checked_sub(Duration::from_secs(age_seconds))
        .unwrap_or(UNIX_EPOCH);
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            warn!(%error, "verification workspace root could not be read");
            return 0;
        }
    };

    let mut removed = 0usize;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warn!(%error, "verification workspace entry could not be read");
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_dir() => metadata,
            Ok(_) => continue,
            Err(error) => {
                warn!(%error, "verification workspace metadata could not be read");
                continue;
            }
        };
        let modified = match metadata.modified() {
            Ok(modified) => modified,
            Err(error) => {
                warn!(%error, "verification workspace modification time is unavailable");
                continue;
            }
        };
        if modified >= cutoff {
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => removed = removed.saturating_add(1),
            Err(error) => warn!(%error, "stale verification workspace could not be removed"),
        }
    }
    removed
}

fn nonnegative_limit(value: i64) -> usize {
    usize::try_from(value.max(0)).unwrap_or(usize::MAX)
}

fn extract_claims(text: &str, max_claims: usize) -> Vec<String> {
    if max_claims == 0 || text.is_empty() {
        return Vec::new();
    }
    split_sentences(text)
        .into_iter()
        .filter(|sentence| {
            let length = sentence.chars().count();
            (20..=500).contains(&length) && is_verifiable_claim(sentence)
        })
        .take(max_claims)
        .collect()
}

fn split_sentences(text: &str) -> Vec<String> {
    let characters: Vec<(usize, char)> = text.char_indices().collect();
    let mut sentences = Vec::new();
    let mut start = 0usize;
    let mut index = 0usize;
    while index + 1 < characters.len() {
        let (byte_index, character) = characters[index];
        if matches!(character, '.' | '!' | '?') && characters[index + 1].1.is_whitespace() {
            let end = byte_index + character.len_utf8();
            let sentence = text[start..end].trim();
            if !sentence.is_empty() {
                sentences.push(sentence.to_owned());
            }
            index += 1;
            while index < characters.len() && characters[index].1.is_whitespace() {
                index += 1;
            }
            start = characters
                .get(index)
                .map_or(text.len(), |(next_byte, _)| *next_byte);
        } else {
            index += 1;
        }
    }
    let final_sentence = text[start..].trim();
    if !final_sentence.is_empty() {
        sentences.push(final_sentence.to_owned());
    }
    sentences
}

fn is_verifiable_claim(sentence: &str) -> bool {
    let lowered = sentence.to_lowercase();
    if [
        "note",
        "remember",
        "keep in mind",
        "it's important",
        "its important",
        "in summary",
        "to summarize",
        "in conclusion",
        "for more information",
        "see also",
        "related",
    ]
    .iter()
    .any(|prefix| lowered.starts_with(prefix))
    {
        return false;
    }

    if lowered.chars().any(char::is_numeric)
        || lowered.chars().any(|character| matches!(character, '\'' | '"'))
    {
        return true;
    }
    let words: Vec<&str> = lowered
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|word| !word.is_empty())
        .collect();
    const SIGNAL_WORDS: &[&str] = &[
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "said",
        "stated",
        "reported",
        "announced",
        "claims",
        "confirmed",
        "denied",
        "greater",
        "fewer",
        "increased",
        "decreased",
        "rose",
        "fell",
        "dropped",
        "surged",
    ];
    words.iter().any(|word| SIGNAL_WORDS.contains(word))
        || ["according to", "more than", "less than"]
            .iter()
            .any(|phrase| lowered.contains(phrase))
}

fn claim_without_sources(claim_hash: String, claim_text: String) -> VerifiedClaim {
    VerifiedClaim {
        id: claim_hash,
        claim_text,
        confidence: 0.2,
        confidence_level: ConfidenceLevel::Low,
        supporting_sources: Vec::new(),
        conflicting_sources: Vec::new(),
        footnotes: Vec::new(),
        needs_recheck: true,
        recheck_reason: Some("No sources found".to_owned()),
    }
}

fn claim_with_sources(
    claim_hash: String,
    claim_text: String,
    sources: &[VerificationSourceInfo],
    recheck_threshold: f64,
) -> VerifiedClaim {
    let confidence = calculate_claim_confidence(sources, SystemTime::now());
    let needs_recheck = confidence < recheck_threshold;
    VerifiedClaim {
        id: claim_hash,
        claim_text,
        confidence,
        confidence_level: confidence_level(confidence),
        supporting_sources: sources
            .iter()
            .filter(|source| source.supports_claim)
            .map(|source| source.id.clone())
            .collect(),
        conflicting_sources: sources
            .iter()
            .filter(|source| !source.supports_claim)
            .map(|source| source.id.clone())
            .collect(),
        footnotes: Vec::new(),
        needs_recheck,
        recheck_reason: needs_recheck.then(|| "Low confidence".to_owned()),
    }
}

fn cached_claim_outcome(
    cached: thesis_db::VerificationCacheRecord,
    config: &VerificationConfig,
) -> Option<ClaimOutcome> {
    if !cached.confidence.is_finite() || !(0.0..=1.0).contains(&cached.confidence) {
        return None;
    }
    let sources: Vec<VerificationSourceInfo> = match cached.sources_json {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(values)) => {
            serde_json::from_value(Value::Array(values)).ok()?
        }
        Some(_) => return None,
    };
    let mut validated_sources = Vec::with_capacity(sources.len());
    for mut source in sources {
        let parsed_url = if source.id.starts_with("internal_") {
            parse_http_url(&source.url)
        } else {
            allowlisted_search_url(&source.url, &config.allowed_domains)
        };
        let (url, domain) = parsed_url?;
        source.url = url;
        source.domain = domain;
        validated_sources.push(source);
    }
    let sources = validated_sources;

    let max_sources = nonnegative_limit(config.max_sources_per_claim);
    let mut sources = sources;
    let sources_were_truncated = sources.len() > max_sources;
    sources.truncate(max_sources);
    let mut claim = VerifiedClaim {
        id: cached.claim_hash,
        claim_text: cached.claim_text,
        confidence: cached.confidence,
        confidence_level: parse_confidence_level(&cached.confidence_level),
        supporting_sources: sources
            .iter()
            .filter(|source| source.supports_claim)
            .map(|source| source.id.clone())
            .collect(),
        conflicting_sources: sources
            .iter()
            .filter(|source| !source.supports_claim)
            .map(|source| source.id.clone())
            .collect(),
        footnotes: Vec::new(),
        needs_recheck: false,
        recheck_reason: None,
    };
    if sources_were_truncated {
        if sources.is_empty() {
            claim.confidence = 0.2;
            claim.confidence_level = ConfidenceLevel::Low;
            claim.needs_recheck = true;
            claim.recheck_reason = Some("No sources found".to_owned());
        } else {
            claim.confidence = calculate_claim_confidence(&sources, SystemTime::now());
            claim.confidence_level = confidence_level(claim.confidence);
            claim.needs_recheck = claim.confidence < config.recheck_threshold;
            claim.recheck_reason = claim
                .needs_recheck
                .then(|| "Low confidence".to_owned());
        }
    }
    Some(ClaimOutcome {
        claim,
        sources,
        cache_hit: true,
    })
}

fn confidence_level(confidence: f64) -> ConfidenceLevel {
    if confidence >= 0.8 {
        ConfidenceLevel::High
    } else if confidence >= 0.5 {
        ConfidenceLevel::Medium
    } else if confidence >= 0.2 {
        ConfidenceLevel::Low
    } else {
        ConfidenceLevel::VeryLow
    }
}

fn confidence_level_name(level: ConfidenceLevel) -> &'static str {
    match level {
        ConfidenceLevel::High => "high",
        ConfidenceLevel::Medium => "medium",
        ConfidenceLevel::Low => "low",
        ConfidenceLevel::VeryLow => "very_low",
    }
}

fn parse_confidence_level(level: &str) -> ConfidenceLevel {
    match level {
        "high" => ConfidenceLevel::High,
        "low" => ConfidenceLevel::Low,
        "very_low" => ConfidenceLevel::VeryLow,
        _ => ConfidenceLevel::Medium,
    }
}

fn calculate_overall_confidence(claims: &[VerifiedClaim]) -> f64 {
    if claims.is_empty() {
        return 0.0;
    }
    let source_count: usize = claims
        .iter()
        .map(|claim| claim.supporting_sources.len() + claim.conflicting_sources.len())
        .sum();
    if source_count == 0 {
        return claims.iter().map(|claim| claim.confidence).sum::<f64>() / claims.len() as f64;
    }
    let weighted_sum: f64 = claims
        .iter()
        .map(|claim| {
            let count = claim.supporting_sources.len() + claim.conflicting_sources.len();
            claim.confidence * count as f64
        })
        .sum();
    (weighted_sum / source_count as f64).clamp(0.0, 1.0)
}

fn calculate_claim_confidence(
    sources: &[VerificationSourceInfo],
    now: SystemTime,
) -> f64 {
    if sources.is_empty() {
        return 0.0;
    }
    let supporting: Vec<&VerificationSourceInfo> =
        sources.iter().filter(|source| source.supports_claim).collect();
    let conflicting: Vec<&VerificationSourceInfo> = sources
        .iter()
        .filter(|source| !source.supports_claim)
        .collect();
    if supporting.is_empty() {
        return if conflicting.is_empty() { 0.0 } else { 0.1 };
    }

    let average_credibility = supporting
        .iter()
        .map(|source| normalized_score(source.credibility_score, 0.3))
        .sum::<f64>()
        / supporting.len() as f64;
    let source_diversity = source_diversity(&supporting);
    let recency = supporting
        .iter()
        .map(|source| source_recency_score(source, now))
        .sum::<f64>()
        / supporting.len() as f64;
    let agreement = agreement_score(&supporting, &conflicting);
    (0.35 * average_credibility + 0.25 * source_diversity + 0.20 * recency + 0.20 * agreement)
        .clamp(0.0, 1.0)
}

fn source_diversity(sources: &[&VerificationSourceInfo]) -> f64 {
    if sources.len() <= 1 {
        return 0.5;
    }
    let unique_types: HashSet<&'static str> = sources
        .iter()
        .map(|source| source_type_name(source.source_type))
        .collect();
    let unique_domains: HashSet<&str> = sources
        .iter()
        .map(|source| source.domain.as_str())
        .collect();
    let type_diversity = (unique_types.len() as f64 / 4.0).min(1.0);
    let domain_diversity = (unique_domains.len() as f64 / 3.0).min(1.0);
    let type_quality = unique_types
        .iter()
        .map(|source_type| source_type_weight(source_type))
        .sum::<f64>()
        / unique_types.len().max(1) as f64;
    0.4 * type_diversity + 0.3 * domain_diversity + 0.3 * type_quality
}

fn agreement_score(
    supporting: &[&VerificationSourceInfo],
    conflicting: &[&VerificationSourceInfo],
) -> f64 {
    if supporting.is_empty() && conflicting.is_empty() {
        return 0.5;
    }
    let supporting_weight = supporting
        .iter()
        .map(|source| normalized_score(source.credibility_score, 0.3))
        .sum::<f64>();
    let conflicting_weight = conflicting
        .iter()
        .map(|source| normalized_score(source.credibility_score, 0.3))
        .sum::<f64>();
    let total_weight = supporting_weight + conflicting_weight;
    if total_weight == 0.0 {
        return 0.5;
    }
    let agreement_ratio = supporting_weight / total_weight;
    let strongest_conflict = conflicting
        .iter()
        .map(|source| normalized_score(source.credibility_score, 0.3))
        .reduce(f64::max);
    let conflict_penalty = match strongest_conflict {
        Some(score) if score > 0.8 => 0.2,
        Some(score) if score > 0.6 => 0.1,
        _ => 0.0,
    };
    (agreement_ratio - conflict_penalty).max(0.0)
}

fn source_recency_score(source: &VerificationSourceInfo, now: SystemTime) -> f64 {
    let Some(published_at) = source.published_at.as_deref() else {
        return 0.5;
    };
    let Some(published_seconds) = parse_iso8601_seconds(published_at) else {
        return 0.5;
    };
    let now_seconds = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX));
    let days_old = now_seconds
        .saturating_sub(published_seconds)
        .div_euclid(24 * 60 * 60);
    if days_old < 1 {
        1.0
    } else if days_old < 7 {
        0.9
    } else if days_old < 30 {
        0.8
    } else if days_old < 90 {
        0.6
    } else if days_old < 365 {
        0.4
    } else {
        0.2
    }
}

fn source_type_weight(source_type: &str) -> f64 {
    match source_type {
        "wire" => 1.0,
        "fact_checker" | "academic" => 0.95,
        "government" => 0.90,
        "broadcast" => 0.88,
        "newspaper" => 0.85,
        "magazine" => 0.80,
        "nonprofit" => 0.75,
        "blog" => 0.40,
        "social" => 0.20,
        _ => 0.30,
    }
}

fn source_type_name(source_type: VerificationSourceType) -> &'static str {
    match source_type {
        VerificationSourceType::Wire => "wire",
        VerificationSourceType::Newspaper => "newspaper",
        VerificationSourceType::Magazine => "magazine",
        VerificationSourceType::Broadcast => "broadcast",
        VerificationSourceType::Nonprofit => "nonprofit",
        VerificationSourceType::FactChecker => "fact_checker",
        VerificationSourceType::Government => "government",
        VerificationSourceType::Academic => "academic",
        VerificationSourceType::Blog => "blog",
        VerificationSourceType::Social => "social",
        VerificationSourceType::Unknown => "unknown",
    }
}

fn parse_source_type(source_type: Option<&str>) -> VerificationSourceType {
    match source_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        "wire" => VerificationSourceType::Wire,
        "newspaper" => VerificationSourceType::Newspaper,
        "magazine" => VerificationSourceType::Magazine,
        "broadcast" => VerificationSourceType::Broadcast,
        "nonprofit" => VerificationSourceType::Nonprofit,
        "fact_checker" => VerificationSourceType::FactChecker,
        "government" => VerificationSourceType::Government,
        "academic" => VerificationSourceType::Academic,
        "blog" => VerificationSourceType::Blog,
        "social" => VerificationSourceType::Social,
        _ => VerificationSourceType::Unknown,
    }
}

fn normalized_score(score: f64, fallback: f64) -> f64 {
    if score.is_finite() {
        score.clamp(0.0, 1.0)
    } else {
        fallback
    }
}

fn normalize_domain(domain: &str) -> String {
    let host = domain.split(':').next().unwrap_or_default().to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(&host).to_owned()
}

fn parse_http_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let candidate = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_owned()
    };
    let parsed = Url::parse(&candidate).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let domain = normalize_domain(parsed.host_str()?);
    (!domain.is_empty()).then_some((candidate, domain))
}

fn allowlisted_search_url(url: &str, allowed_domains: &[String]) -> Option<(String, String)> {
    let (candidate, domain) = parse_http_url(url)?;
    is_domain_allowed(&candidate, allowed_domains).then_some((candidate, domain))
}

fn push_unique_source(
    sources: &mut Vec<VerificationSourceInfo>,
    seen_urls: &mut HashSet<String>,
    source: VerificationSourceInfo,
    limit: usize,
) {
    if sources.len() < limit && seen_urls.insert(source.url.clone()) {
        sources.push(source);
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

async fn ddg_post(
    client: &Client,
    endpoint: &str,
    query: &str,
    max_results: usize,
) -> Result<Vec<DdgSearchResult>, String> {
    if max_results == 0 {
        return Ok(Vec::new());
    }
    let body = ddg_form_body(query);
    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|_| "DuckDuckGo request failed".to_owned())?;
    if response.status() != StatusCode::OK {
        return Err(format!("DuckDuckGo returned HTTP {}", response.status()));
    }
    if response.url().as_str() != endpoint {
        return Err("DuckDuckGo request left the fixed search endpoint".to_owned());
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type
        .split(';')
        .next()
        .is_some_and(|media_type| media_type.trim().eq_ignore_ascii_case("text/html"))
    {
        return Err("DuckDuckGo returned an unexpected content type".to_owned());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DDG_RESPONSE_BYTES as u64)
    {
        return Err("DuckDuckGo response exceeded the byte limit".to_owned());
    }

    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .map_or(4096, |length| length.min(MAX_DDG_RESPONSE_BYTES));
    let mut response = response;
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "DuckDuckGo response could not be read".to_owned())?
    {
        if body
            .len()
            .checked_add(chunk.len())
            .is_none_or(|length| length > MAX_DDG_RESPONSE_BYTES)
        {
            return Err("DuckDuckGo response exceeded the byte limit".to_owned());
        }
        body.extend_from_slice(&chunk);
    }
    let html = std::str::from_utf8(&body)
        .map_err(|_| "DuckDuckGo response was not valid UTF-8".to_owned())?;
    Ok(parse_ddg_results(html, max_results))
}

fn ddg_form_body(query: &str) -> String {
    format!(
        "q={}&b=&l=us-en",
        encode_form_component(query)
    )
}

fn encode_form_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                encoded.push(char::from(byte));
            }
            b' ' => encoded.push('+'),
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                encoded.push('%');
                encoded.push(char::from(HEX[(byte >> 4) as usize]));
                encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
            }
        }
    }
    encoded
}

fn parse_ddg_results(html: &str, max_results: usize) -> Vec<DdgSearchResult> {
    if max_results == 0 {
        return Vec::new();
    }
    let mut results = Vec::new();
    let mut cursor = 0usize;
    while cursor < html.len() && results.len() < max_results {
        let Some(tag) = next_html_tag(html, cursor) else {
            break;
        };
        cursor = tag.end;
        if tag.closing
            || !tag.name.eq_ignore_ascii_case("div")
            || !class_has_token(tag.attributes, "result__body")
        {
            continue;
        }
        let Some((content_end, block_end)) = matching_element_end(html, &tag, "div") else {
            break;
        };
        let block = &html[tag.end..content_end];
        if let Some(result) = parse_ddg_result_block(block) {
            results.push(result);
        }
        cursor = block_end;
    }
    results
}

fn parse_ddg_result_block(block: &str) -> Option<DdgSearchResult> {
    let title = first_element_text(block, "h2")?;
    let (href, excerpt) = first_class_anchor(block, "result__snippet")?;
    if href.trim().is_empty() {
        return None;
    }
    Some(DdgSearchResult {
        title,
        href: decode_html_entities(&href),
        excerpt,
    })
}

fn first_element_text(html: &str, name: &str) -> Option<String> {
    let mut cursor = 0usize;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if tag.closing || !tag.name.eq_ignore_ascii_case(name) {
            continue;
        }
        let (content_end, _) = matching_element_end(html, &tag, name)?;
        return Some(text_content(&html[tag.end..content_end]));
    }
    None
}

fn first_class_anchor(html: &str, class_name: &str) -> Option<(String, String)> {
    let mut cursor = 0usize;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if tag.closing
            || !tag.name.eq_ignore_ascii_case("a")
            || !class_has_token(tag.attributes, class_name)
        {
            continue;
        }
        let href = attribute_value(tag.attributes, "href")?.to_owned();
        let (content_end, _) = matching_element_end(html, &tag, "a")?;
        return Some((href, text_content(&html[tag.end..content_end])));
    }
    None
}

struct HtmlTag<'a> {
    name: &'a str,
    attributes: &'a str,
    start: usize,
    end: usize,
    closing: bool,
    self_closing: bool,
}

fn next_html_tag(html: &str, from: usize) -> Option<HtmlTag<'_>> {
    let mut cursor = from;
    loop {
        let start = cursor + html.get(cursor..)?.find('<')?;
        if html[start..].starts_with("<!--") {
            let comment_end = html[start + 4..].find("-->")?;
            cursor = start + 4 + comment_end + 3;
            continue;
        }
        let end = find_tag_end(html, start)?;
        let tag = parse_html_tag(html, start, end)?;
        if tag.name.is_empty() || matches!(tag.name.chars().next(), Some('!' | '?')) {
            cursor = end;
            continue;
        }
        return Some(tag);
    }
}

fn find_tag_end(html: &str, start: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut quote = None;
    for (index, byte) in bytes.iter().enumerate().skip(start + 1) {
        match (*byte, quote) {
            (b'\'' | b'"', None) => quote = Some(*byte),
            (byte, Some(quote_byte)) if byte == quote_byte => quote = None,
            (b'>', None) => return Some(index + 1),
            _ => {}
        }
    }
    None
}

fn parse_html_tag(html: &str, start: usize, end: usize) -> Option<HtmlTag<'_>> {
    let inner = html.get(start + 1..end.checked_sub(1)?)?.trim_start();
    let closing = inner.starts_with('/');
    let content = if closing {
        inner[1..].trim_start()
    } else {
        inner
    };
    let name_end = content
        .find(|character: char| character.is_ascii_whitespace() || character == '/')
        .unwrap_or(content.len());
    Some(HtmlTag {
        name: &content[..name_end],
        attributes: &content[name_end..],
        start,
        end,
        closing,
        self_closing: content.trim_end().ends_with('/'),
    })
}

fn matching_element_end(html: &str, opening: &HtmlTag<'_>, name: &str) -> Option<(usize, usize)> {
    if opening.self_closing {
        return Some((opening.end, opening.end));
    }
    let mut depth = 1usize;
    let mut cursor = opening.end;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if !tag.name.eq_ignore_ascii_case(name) {
            continue;
        }
        if tag.closing {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some((tag.start, tag.end));
            }
        } else if !tag.self_closing {
            depth = depth.checked_add(1)?;
        }
    }
    None
}

fn class_has_token(attributes: &str, token: &str) -> bool {
    attribute_value(attributes, "class").is_some_and(|classes| {
        classes
            .split_whitespace()
            .any(|class| class.eq_ignore_ascii_case(token))
    })
}

fn attribute_value<'a>(attributes: &'a str, name: &str) -> Option<&'a str> {
    let bytes = attributes.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/') {
            index += 1;
        }
        let key_start = index;
        while index < bytes.len()
            && !bytes[index].is_ascii_whitespace()
            && bytes[index] != b'='
            && bytes[index] != b'/'
        {
            index += 1;
        }
        if key_start == index {
            index = index.saturating_add(1);
            continue;
        }
        let key = attributes.get(key_start..index)?;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'=' {
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        let (value_start, value_end) = if bytes[index] == b'\'' || bytes[index] == b'"' {
            let quote = bytes[index];
            index += 1;
            let start = index;
            while index < bytes.len() && bytes[index] != quote {
                index += 1;
            }
            let end = index;
            index = index.saturating_add(1);
            (start, end)
        } else {
            let start = index;
            while index < bytes.len() && !bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            (start, index)
        };
        if key.eq_ignore_ascii_case(name) {
            return attributes.get(value_start..value_end);
        }
    }
    None
}

fn text_content(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut inside_tag = false;
    for character in html.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = decode_html_entities(&text);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_html_entities(text: &str) -> String {
    let mut decoded = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < text.len() {
        if text.as_bytes()[index] == b'&' {
            if let Some(relative_end) = text[index..].find(';') {
                if relative_end <= 16 {
                    let entity = &text[index + 1..index + relative_end];
                    if let Some(character) = decode_entity(entity) {
                        decoded.push(character);
                        index += relative_end + 1;
                        continue;
                    }
                }
            }
        }
        let character = text[index..].chars().next().unwrap_or_default();
        decoded.push(character);
        index += character.len_utf8();
    }
    decoded
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "nbsp" => Some(' '),
        "mdash" => Some('—'),
        "ndash" => Some('–'),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn format_markdown_report(
    claims: &[VerifiedClaim],
    sources: &BTreeMap<String, VerificationSourceInfo>,
    overall_confidence: f64,
) -> String {
    if claims.is_empty() {
        return "No claims were verified.".to_owned();
    }
    let mut lines = vec![
        "## Verification Summary".to_owned(),
        String::new(),
        format!(
            "**Overall Confidence:** {:.0}% {}",
            overall_confidence * 100.0,
            confidence_indicator(confidence_level(overall_confidence))
        ),
        String::new(),
        "## Verified Claims".to_owned(),
        String::new(),
    ];
    let mut footnote_numbers = BTreeMap::new();
    let mut next_footnote = 0usize;
    for claim in claims {
        lines.push(format!(
            "- {} {}",
            confidence_indicator(claim.confidence_level),
            claim.claim_text
        ));
        let mut references = Vec::new();
        for source_id in claim
            .supporting_sources
            .iter()
            .chain(claim.conflicting_sources.iter())
        {
            let footnote = *footnote_numbers.entry(source_id.clone()).or_insert_with(|| {
                next_footnote = next_footnote.saturating_add(1);
                next_footnote
            });
            references.push(format!("[^{footnote}]"));
        }
        if !references.is_empty() {
            if let Some(line) = lines.last_mut() {
                line.push(' ');
                line.push_str(&references.join(""));
            }
        }
        if claim.needs_recheck {
            if let Some(reason) = claim.recheck_reason.as_deref() {
                lines.push(format!("  - *Note: {reason}*"));
            }
        }
        lines.push(String::new());
    }
    if !footnote_numbers.is_empty() {
        lines.push("## Sources".to_owned());
        lines.push(String::new());
        let mut ordered_footnotes: Vec<(&String, &usize)> = footnote_numbers.iter().collect();
        ordered_footnotes.sort_by_key(|(_, number)| **number);
        for (source_id, number) in ordered_footnotes {
            let Some(source) = sources.get(source_id) else {
                continue;
            };
            let title = source
                .title
                .as_deref()
                .filter(|title| !title.is_empty())
                .unwrap_or(&source.domain);
            let support_text = if source.supports_claim {
                "supports"
            } else {
                "contradicts"
            };
            lines.push(format!(
                "[^{number}]: [{title}]({}) ({support_text}, credibility: {:.0}%)",
                source.url,
                source.credibility_score * 100.0
            ));
        }
    }
    lines.join("\n")
}

fn confidence_indicator(level: ConfidenceLevel) -> &'static str {
    match level {
        ConfidenceLevel::High => "[HIGH]",
        ConfidenceLevel::Medium => "[MEDIUM]",
        ConfidenceLevel::Low => "[LOW]",
        ConfidenceLevel::VeryLow => "[VERY LOW]",
    }
}

fn parse_iso8601_seconds(value: &str) -> Option<i64> {
    let (date, time) = value
        .split_once('T')
        .or_else(|| value.split_once(' '))
        .unwrap_or((value, "00:00:00"));
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i64>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    if !(1..=9999).contains(&year)
        || date_parts.next().is_some()
        || !(1..=12).contains(&month)
    {
        return None;
    }
    let days_in_month = match month {
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if day == 0 || day > days_in_month {
        return None;
    }

    let zone_start = time
        .find(|character| matches!(character, '+' | '-' | 'Z' | 'z'))
        .unwrap_or(time.len());
    let clock = &time[..zone_start];
    let mut clock_parts = clock.split(':');
    let hour = clock_parts.next().unwrap_or("0").parse::<i64>().ok()?;
    let minute = clock_parts.next().unwrap_or("0").parse::<i64>().ok()?;
    let second = clock_parts
        .next()
        .unwrap_or("0")
        .split('.')
        .next()?
        .parse::<i64>()
        .ok()?;
    if clock_parts.next().is_some() || !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }
    if !(0..=59).contains(&second) {
        return None;
    }

    let zone = &time[zone_start..];
    let offset = if zone.is_empty() || zone == "Z" || zone == "z" {
        0
    } else {
        let sign = if zone.starts_with('+') {
            1
        } else if zone.starts_with('-') {
            -1
        } else {
            return None;
        };
        let mut offset_parts = zone[1..].split(':');
        let offset_hour = offset_parts.next()?.parse::<i64>().ok()?;
        let offset_minute = offset_parts
            .next()
            .unwrap_or("0")
            .parse::<i64>()
            .ok()?;
        if offset_parts.next().is_some()
            || !(0..=23).contains(&offset_hour)
            || !(0..=59).contains(&offset_minute)
        {
            return None;
        }
        sign * (offset_hour * 3600 + offset_minute * 60)
    };
    Some(
        days_from_civil(year, month, day)
            .saturating_mul(24 * 60 * 60)
            .saturating_add(hour * 3600 + minute * 60 + second)
            .saturating_sub(offset),
    )
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn iso8601_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = i64::try_from(now.as_secs()).unwrap_or(i64::MAX);
    let days = seconds.div_euclid(24 * 60 * 60);
    let seconds_in_day = seconds.rem_euclid(24 * 60 * 60);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_in_day / 3600;
    let minute = (seconds_in_day % 3600) / 60;
    let second = seconds_in_day % 60;
    let base = format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}");
    let micros = now.subsec_micros();
    if micros == 0 {
        base
    } else {
        format!("{base}.{micros:06}")
    }
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted_days = days + 719_468;
    let era = if shifted_days >= 0 {
        shifted_days
    } else {
        shifted_days - 146_096
    }
    .div_euclid(146_097);
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524
        - day_of_era / 146_096)
        / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use axum::http::header::LOCATION;
    use axum::http::StatusCode as AxumStatusCode;
    use axum::response::IntoResponse;
    use axum::routing::{get, post};
    use axum::Router;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;

    const DDG_FIXTURE: &str = r#"
        <div class="links_main links_deep result__body">
          <h2 class="result__title"><a class="result__a" href="https://www.reuters.com/story">NASA&#x27;s Artemis report | Reuters</a></h2>
          <a class="result__snippet" href="https://www.reuters.com/story?a=1&amp;b=2">The agency <b>announced</b> 14 flights in 2024.</a>
        </div>
        <div class="links_main links_deep result__body">
          <h2 class="result__title"><a class="result__a" href="https://evil.example/story">Untrusted report</a></h2>
          <a class="result__snippet" href="https://evil.example/story">A claim with 21 results.</a>
        </div>
    "#;

    #[test]
    fn extracts_only_bounded_verifiable_claims() {
        let answer = concat!(
            "This opening sentence contains enough words but no checkable detail. ",
            "The agency announced 14 flights in March 2024. ",
            "In summary, the agency announced 14 flights."
        );
        assert_eq!(
            extract_claims(answer, 1),
            vec!["The agency announced 14 flights in March 2024."]
        );
        assert!(extract_claims(answer, 0).is_empty());
        assert!(extract_claims(&"x".repeat(501), 10).is_empty());
    }

    #[test]
    fn parses_duckduckgo_result_body_and_applies_allowlist_boundaries() {
        let results = parse_ddg_results(DDG_FIXTURE, 5);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "NASA's Artemis report | Reuters");
        assert_eq!(
            results[0].href,
            "https://www.reuters.com/story?a=1&b=2"
        );
        assert_eq!(results[0].excerpt, "The agency announced 14 flights in 2024.");

        let allowed = vec!["reuters.com".to_owned()];
        let (url, domain) = allowlisted_search_url(&results[0].href, &allowed).unwrap();
        assert_eq!(url, results[0].href);
        assert_eq!(domain, "reuters.com");
        assert!(allowlisted_search_url(&results[1].href, &allowed).is_none());
        assert!(allowlisted_search_url("https://notreuters.com/story", &allowed).is_none());
        assert!(allowlisted_search_url("javascript://reuters.com/story", &allowed).is_none());
        assert!(
            allowlisted_search_url("https://user@reuters.com/story", &allowed).is_none()
        );
        assert_eq!(
            parse_http_url("//www.reuters.com/story").unwrap(),
            (
                "https://www.reuters.com/story".to_owned(),
                "reuters.com".to_owned()
            )
        );
    }

    #[test]
    fn ddg_form_uses_pinned_engine_contract_and_url_encoding() {
        assert_eq!(
            ddg_form_body("NASA Artemis + moon"),
            "q=NASA+Artemis+%2B+moon&b=&l=us-en"
        );
    }

    #[test]
    fn source_scoring_matches_the_single_source_weights() {
        let source = VerificationSourceInfo {
            id: "source-1".to_owned(),
            url: "https://reuters.com/story".to_owned(),
            title: Some("Report".to_owned()),
            domain: "reuters.com".to_owned(),
            credibility_score: 0.9,
            source_type: VerificationSourceType::Wire,
            published_at: None,
            supports_claim: true,
            excerpt: None,
        };
        let confidence = calculate_claim_confidence(&[source], SystemTime::now());
        assert!((confidence - 0.74).abs() < 0.000_001);
        assert_eq!(confidence_level(0.8), ConfidenceLevel::High);
        assert_eq!(confidence_level(0.5), ConfidenceLevel::Medium);
        assert_eq!(confidence_level(0.2), ConfidenceLevel::Low);
        assert_eq!(confidence_level(0.199), ConfidenceLevel::VeryLow);
    }

    #[test]
    fn timestamp_parser_handles_naive_and_offset_values() {
        assert_eq!(parse_iso8601_seconds("2000-01-01T00:00:00"), Some(946_684_800));
        assert_eq!(
            parse_iso8601_seconds("2000-01-01T01:00:00+01:00"),
            Some(946_684_800)
        );
        assert_eq!(
            parse_iso8601_seconds("2000-02-29"),
            Some(951_782_400)
        );
        assert!(parse_iso8601_seconds("2001-02-29").is_none());
        assert!(parse_iso8601_seconds("0000-01-01").is_none());
        assert!(parse_iso8601_seconds("10000-01-01").is_none());
        assert!(parse_iso8601_seconds("2000-01-01T00:00:60Z").is_none());
    }

    #[test]
    fn workspace_cleanup_removes_only_expired_child_directories() {
        let root = std::env::temp_dir().join(format!(
            "thesis-verification-cleaner-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("session")).unwrap();
        fs::write(root.join("keep.txt"), "not a workspace directory").unwrap();
        std::thread::sleep(Duration::from_millis(5));

        let removed = cleanup_stale_workspaces(&root, 0);
        assert_eq!(removed, 1);
        assert!(!root.join("session").exists());
        assert!(root.join("keep.txt").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    async fn redirect_to_result() -> impl IntoResponse {
        (AxumStatusCode::FOUND, [(LOCATION, "/landed")])
    }

    async fn count_redirect_target(State(hits): State<Arc<AtomicUsize>>) -> AxumStatusCode {
        hits.fetch_add(1, Ordering::SeqCst);
        AxumStatusCode::OK
    }

    #[tokio::test]
    async fn ddg_client_does_not_follow_redirects() {
        let hits = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/html/", post(redirect_to_result))
            .route("/landed", get(count_redirect_target))
            .with_state(hits.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = new_ddg_client().unwrap();
        let endpoint = format!("http://{address}/html/");

        let result = ddg_post(&client, &endpoint, "claim", 5).await;
        assert!(result.is_err());
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        server.abort();
    }
}
