use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use thesis_db::{
    BlindspotArticleRecord, BlindspotSourceArticleRecord, Database, SourceCoverageStatsWrite,
    TopicClusterSnapshotRecord,
};
use thesis_search::topics::{extract_keywords_from_titles, generate_cluster_label};
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, ToSchema};

use crate::chroma::{ChromaClient, ChromaGetRequest, ChromaInclude, ChromaQueryRequest};
use crate::embedding::EmbeddingClient;
use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

/// Future returned by the live database/vector analysis boundary.
pub type BlindspotAnalysisFuture<T> =
    Pin<Box<dyn Future<Output = Result<T, BlindspotAnalysisError>> + Send>>;

/// Failure returned by a blindspot analysis integration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BlindspotAnalysisError {
    /// Database, Chroma, or an embedding dependency is not configured or reachable.
    Unavailable,
    /// A configured analysis or persistence operation failed.
    Failed(String),
}

/// Provider boundary for source/topic analysis and daily statistics persistence.
///
/// Analysis implementations query live article/source data, topic vectors, and
/// the embedding sidecar. They must not substitute `topic_cluster_snapshots` or
/// treat a missing database/vector/embed dependency as a successful empty result.
/// The stats operation must commit today's source aggregates before returning.
pub trait BlindspotAnalysisProvider: Send + Sync {
    fn analyze_source_coverage(
        &self,
        source_name: String,
        days: i64,
    ) -> BlindspotAnalysisFuture<SourceBlindSpotsResponse>;

    fn identify_topic_blind_spots(
        &self,
        min_sources: i64,
    ) -> BlindspotAnalysisFuture<Vec<TopicBlindSpotResponse>>;

    fn generate_source_coverage_report(
        &self,
        days: i64,
    ) -> BlindspotAnalysisFuture<CoverageReportResponse>;

    fn update_daily_coverage_stats(&self) -> BlindspotAnalysisFuture<i64>;
}

/// Optional live blindspot integration attached to the module router.
#[derive(Clone, Default)]
pub struct BlindspotAnalysisState {
    provider: Option<Arc<dyn BlindspotAnalysisProvider>>,
}

impl BlindspotAnalysisState {
    /// Build a state with a live database/Chroma analysis provider.
    pub fn with_provider(provider: impl BlindspotAnalysisProvider + 'static) -> Self {
        Self {
            provider: Some(Arc::new(provider)),
        }
    }

    /// Build a state where live blindspot analysis is explicitly unavailable.
    pub fn unavailable() -> Self {
        Self::default()
    }
    /// Whether a live analysis provider is attached; this does not probe its dependencies.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }
}

const SOURCE_TOPIC_ARTICLE_LIMIT: usize = 1_000;
const GENERAL_TOPIC_ARTICLE_LIMIT: usize = 3_000;
const TOPIC_RESULT_LIMIT: usize = 200;
const SOURCE_TOPIC_RESULT_LIMIT: usize = 1_000;
const CHROMA_GET_BATCH_SIZE: usize = 1_000;
const EMBEDDING_BATCH_SIZE: usize = 256;
const CHROMA_QUERY_BATCH_SIZE: usize = 128;
const CHROMA_QUERY_RESULT_COUNT: usize = 50;
const TOPIC_SIMILARITY_THRESHOLD: f64 = 0.82;

/// Live provider built from the shared database, Chroma, and embedding clients.
#[derive(Clone)]
pub struct LiveBlindspotAnalysisProvider {
    database: Database,
    chroma: ChromaClient,
    embeddings: EmbeddingClient,
}

impl BlindspotAnalysisState {
    /// Build a production provider from the central shared service clients.
    pub fn with_live_integrations(
        database: Database,
        chroma: ChromaClient,
        embeddings: EmbeddingClient,
    ) -> Self {
        Self::with_provider(LiveBlindspotAnalysisProvider {
            database,
            chroma,
            embeddings,
        })
    }
}

impl BlindspotAnalysisProvider for LiveBlindspotAnalysisProvider {
    fn analyze_source_coverage(
        &self,
        source_name: String,
        days: i64,
    ) -> BlindspotAnalysisFuture<SourceBlindSpotsResponse> {
        let provider = self.clone();
        Box::pin(async move {
            provider
                .analyze_source_coverage_live(&source_name, days)
                .await
        })
    }

    fn identify_topic_blind_spots(
        &self,
        min_sources: i64,
    ) -> BlindspotAnalysisFuture<Vec<TopicBlindSpotResponse>> {
        let provider = self.clone();
        Box::pin(async move { provider.identify_topic_blind_spots_live(min_sources).await })
    }

    fn generate_source_coverage_report(
        &self,
        days: i64,
    ) -> BlindspotAnalysisFuture<CoverageReportResponse> {
        let provider = self.clone();
        Box::pin(async move { provider.generate_source_coverage_report_live(days).await })
    }

    fn update_daily_coverage_stats(&self) -> BlindspotAnalysisFuture<i64> {
        let provider = self.clone();
        Box::pin(async move { provider.update_daily_coverage_stats_live().await })
    }
}

#[derive(Clone, Debug)]
struct LiveTopicCluster {
    cluster_id: i64,
    member_ids: Vec<i64>,
}

#[derive(Clone, Debug)]
struct LiveTopicDetail {
    cluster_id: i64,
    label: String,
    keywords: Vec<String>,
    article_count: i64,
    member_ids: Vec<i64>,
    covering_sources: Vec<String>,
    blind_spot_sources: Vec<String>,
}

async fn load_live_topic_clusters(
    database: &Database,
    chroma: &ChromaClient,
    embeddings: &EmbeddingClient,
    since: NaiveDateTime,
    article_limit: usize,
    result_limit: usize,
) -> Result<Vec<LiveTopicCluster>, BlindspotAnalysisError> {
    let article_limit = i64::try_from(article_limit)
        .map_err(|_| BlindspotAnalysisError::Failed("article limit overflowed".into()))?;
    let article_ids = database
        .list_recent_blindspot_article_ids(since, article_limit)
        .await
        .map_err(database_analysis_error)?;
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }

    let health = embeddings
        .health()
        .await
        .map_err(|_| BlindspotAnalysisError::Unavailable)?;
    if !health.ok {
        return Err(BlindspotAnalysisError::Unavailable);
    }
    let collection = chroma
        .get_collection()
        .await
        .map_err(|_| BlindspotAnalysisError::Unavailable)?;
    if collection
        .count()
        .await
        .map_err(|_| BlindspotAnalysisError::Unavailable)?
        == 0
    {
        return Err(BlindspotAnalysisError::Unavailable);
    }

    let mut documents = Vec::new();
    for batch in article_ids.chunks(CHROMA_GET_BATCH_SIZE) {
        let chroma_ids = batch
            .iter()
            .map(|article_id| format!("article_{article_id}"))
            .collect();
        let response = collection
            .get(ChromaGetRequest {
                ids: Some(chroma_ids),
                include: vec![ChromaInclude::Documents],
                ..ChromaGetRequest::default()
            })
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?;
        let response_documents = response
            .documents
            .ok_or(BlindspotAnalysisError::Unavailable)?;
        for (chroma_id, document) in response.ids.into_iter().zip(response_documents) {
            let Some(article_id) = parse_chroma_article_id(&chroma_id) else {
                continue;
            };
            let Some(document) = document.filter(|document| !document.trim().is_empty()) else {
                continue;
            };
            documents.push((article_id, document));
        }
    }
    if documents.is_empty() {
        return Err(BlindspotAnalysisError::Unavailable);
    }

    let mut candidate_embeddings = Vec::with_capacity(documents.len());
    for document_batch in documents.chunks(EMBEDDING_BATCH_SIZE) {
        let texts = document_batch
            .iter()
            .map(|(_, document)| document.clone())
            .collect::<Vec<_>>();
        let response = embeddings
            .embed(&texts, 32)
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?;
        candidate_embeddings.extend(
            document_batch
                .iter()
                .zip(response.embeddings)
                .map(|((article_id, _), vector)| (*article_id, vector)),
        );
    }

    let mut candidates = BTreeMap::new();
    for query_batch in candidate_embeddings.chunks(CHROMA_QUERY_BATCH_SIZE) {
        let response = collection
            .query(ChromaQueryRequest {
                query_embeddings: query_batch
                    .iter()
                    .map(|(_, vector)| vector.clone())
                    .collect(),
                n_results: CHROMA_QUERY_RESULT_COUNT,
                where_filter: None,
                where_document: None,
                include: vec![ChromaInclude::Distances],
            })
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?;
        let distances = response
            .distances
            .ok_or(BlindspotAnalysisError::Unavailable)?;
        for ((anchor_id, _), (member_ids, distances)) in query_batch
            .iter()
            .zip(response.ids.into_iter().zip(distances))
        {
            let members = topic_members_from_query(*anchor_id, member_ids, distances);
            if members.len() >= 2 {
                candidates.insert(*anchor_id, members);
            }
        }
    }

    Ok(live_clusters_from_candidates(candidates, result_limit))
}

fn topic_members_from_query(
    anchor_id: i64,
    member_ids: Vec<String>,
    distances: Vec<f64>,
) -> BTreeMap<i64, f64> {
    let mut members = BTreeMap::new();
    for (member_id, distance) in member_ids.into_iter().zip(distances) {
        let Some(member_id) = parse_chroma_article_id(&member_id) else {
            continue;
        };
        if !distance.is_finite() {
            continue;
        }
        let similarity = 1.0 - distance;
        if similarity >= TOPIC_SIMILARITY_THRESHOLD {
            members.entry(member_id).or_insert(similarity);
        }
    }
    members.entry(anchor_id).or_insert(1.0);
    members
}

fn live_clusters_from_candidates(
    candidates: BTreeMap<i64, BTreeMap<i64, f64>>,
    result_limit: usize,
) -> Vec<LiveTopicCluster> {
    let mut parents = HashMap::new();
    for (anchor_id, members) in &candidates {
        for member_id in members.keys() {
            union_find_add(&mut parents, *member_id);
            union_find_union(&mut parents, *anchor_id, *member_id);
        }
    }
    let ids = parents.keys().copied().collect::<Vec<_>>();
    let mut components: BTreeMap<i64, BTreeSet<i64>> = BTreeMap::new();
    for article_id in ids {
        let root = union_find_root(&mut parents, article_id);
        components.entry(root).or_default().insert(article_id);
    }

    let mut clusters = Vec::new();
    for members in components.into_values() {
        if members.len() < 5 {
            continue;
        }
        let mut best_anchor = None;
        let mut best_score = (0usize, f64::NEG_INFINITY);
        for article_id in &members {
            let Some(similarities) = candidates.get(article_id) else {
                continue;
            };
            let average_similarity = similarities.values().sum::<f64>() / similarities.len() as f64;
            let score = (similarities.len(), average_similarity);
            if score > best_score {
                best_anchor = Some(*article_id);
                best_score = score;
            }
        }
        let Some(cluster_id) = best_anchor else {
            continue;
        };
        clusters.push(LiveTopicCluster {
            cluster_id,
            member_ids: members.into_iter().collect(),
        });
    }
    clusters.sort_by_key(|cluster| cluster.cluster_id);
    clusters.truncate(result_limit);
    clusters
}

fn parse_chroma_article_id(chroma_id: &str) -> Option<i64> {
    chroma_id
        .strip_prefix("article_")
        .and_then(|article_id| article_id.parse::<i64>().ok())
        .filter(|article_id| *article_id > 0)
}

fn union_find_add(parents: &mut HashMap<i64, i64>, article_id: i64) {
    parents.entry(article_id).or_insert(article_id);
}

fn union_find_root(parents: &mut HashMap<i64, i64>, article_id: i64) -> i64 {
    let parent = *parents.entry(article_id).or_insert(article_id);
    if parent == article_id {
        return article_id;
    }
    let root = union_find_root(parents, parent);
    parents.insert(article_id, root);
    root
}

fn union_find_union(parents: &mut HashMap<i64, i64>, left: i64, right: i64) {
    let left_root = union_find_root(parents, left);
    let right_root = union_find_root(parents, right);
    if left_root != right_root {
        let (root, child) = if left_root < right_root {
            (left_root, right_root)
        } else {
            (right_root, left_root)
        };
        parents.insert(child, root);
    }
}

async fn load_live_topic_details(
    database: &Database,
    clusters: Vec<LiveTopicCluster>,
    active_sources: Option<&BTreeSet<String>>,
) -> Result<Vec<LiveTopicDetail>, BlindspotAnalysisError> {
    let article_ids = clusters
        .iter()
        .flat_map(|cluster| cluster.member_ids.iter().copied())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    let records = database
        .load_blindspot_articles(&article_ids)
        .await
        .map_err(database_analysis_error)?;
    let records_by_id = records
        .into_iter()
        .map(|record| (record.id, record))
        .collect::<HashMap<_, _>>();
    let now = Utc::now().naive_utc();
    let mut details = Vec::with_capacity(clusters.len());
    for cluster in clusters {
        let articles = cluster
            .member_ids
            .iter()
            .filter_map(|article_id| records_by_id.get(article_id))
            .collect::<Vec<_>>();
        if articles.is_empty() {
            continue;
        }
        let title_scores = articles
            .iter()
            .filter(|article| !article.title.is_empty())
            .map(|article| (article.title.clone(), topic_title_score(article, now)))
            .collect::<Vec<_>>();
        let titles = articles
            .iter()
            .map(|article| article.title.clone())
            .collect::<Vec<_>>();
        let label = generate_cluster_label(title_scores);
        let keywords = extract_keywords_from_titles(titles);
        let covering_sources: Vec<String> = active_sources
            .map(|_| {
                articles
                    .iter()
                    .map(|article| article.source.as_str())
                    .filter(|source| !source.is_empty())
                    .map(str::to_owned)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            })
            .unwrap_or_default();
        let blind_spot_sources = active_sources
            .map(|sources| {
                sources
                    .iter()
                    .filter(|source| !covering_sources.contains(*source))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let article_count = i64::try_from(cluster.member_ids.len())
            .map_err(|_| BlindspotAnalysisError::Failed("topic article count overflowed".into()))?;
        details.push(LiveTopicDetail {
            cluster_id: cluster.cluster_id,
            label,
            keywords,
            article_count,
            member_ids: cluster.member_ids,
            covering_sources,
            blind_spot_sources,
        });
    }
    Ok(details)
}

fn topic_title_score(article: &BlindspotArticleRecord, now: NaiveDateTime) -> f64 {
    let title = article.title.trim();
    let length = title.chars().count();
    let length_score = match length {
        40..=100 => 10.0,
        30..=39 => 7.0,
        101..=140 => 6.0,
        0..=29 => 3.0,
        _ => 1.0,
    };
    let credibility_score = match article.credibility.as_deref() {
        Some("high") => 5.0,
        Some("medium") => 2.0,
        _ => 0.0,
    };
    let recency_score = article
        .published_at
        .map(|published_at| {
            let hours = now.signed_duration_since(published_at).num_seconds() as f64 / 3_600.0;
            if hours < 6.0 {
                3.0
            } else if hours < 24.0 {
                2.0
            } else if hours < 72.0 {
                1.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);
    let lower_title = title.to_lowercase();
    let generic_penalty = ["breaking", "update", "news alert", "developing"]
        .iter()
        .filter(|term| lower_title.contains(**term))
        .count() as f64
        * -5.0;
    let capitalization_score = (title
        .split_whitespace()
        .filter(|word| word.chars().next().is_some_and(char::is_uppercase))
        .count() as f64
        * 1.5)
        .min(8.0);
    length_score + credibility_score + recency_score + generic_penalty + capitalization_score
}

fn database_analysis_error(error: impl std::fmt::Display) -> BlindspotAnalysisError {
    BlindspotAnalysisError::Failed(error.to_string())
}

impl LiveBlindspotAnalysisProvider {
    async fn analyze_source_coverage_live(
        &self,
        source_name: &str,
        days: i64,
    ) -> Result<SourceBlindSpotsResponse, BlindspotAnalysisError> {
        let since = analysis_since(days);
        let articles = self
            .database
            .list_blindspot_source_articles(Some(source_name), since)
            .await
            .map_err(database_analysis_error)?;
        let topics = if articles.is_empty() {
            Vec::new()
        } else {
            let clusters = load_live_topic_clusters(
                &self.database,
                &self.chroma,
                &self.embeddings,
                since,
                SOURCE_TOPIC_ARTICLE_LIMIT,
                SOURCE_TOPIC_RESULT_LIMIT,
            )
            .await?;
            load_live_topic_details(&self.database, clusters, None).await?
        };
        let source_article_ids = articles
            .iter()
            .map(|article| article.id)
            .collect::<HashSet<_>>();
        let topics_covered = topics
            .iter()
            .filter(|topic| {
                topic
                    .member_ids
                    .iter()
                    .any(|article_id| source_article_ids.contains(article_id))
            })
            .count();
        let total_active_topics = i64::try_from(topics.len())
            .map_err(|_| BlindspotAnalysisError::Failed("topic count overflowed".into()))?;
        let topics_covered = i64::try_from(topics_covered)
            .map_err(|_| BlindspotAnalysisError::Failed("covered topic count overflowed".into()))?;
        let coverage_ratio = topics_covered as f64 / total_active_topics.max(1) as f64;
        let article_count = i64::try_from(articles.len())
            .map_err(|_| BlindspotAnalysisError::Failed("article count overflowed".into()))?;
        Ok(SourceBlindSpotsResponse {
            source: source_name.to_owned(),
            article_count,
            topics_covered,
            total_active_topics,
            coverage_ratio,
            blind_spots: source_blind_spot_values(&topics, &source_article_ids),
            coverage_gaps: identify_coverage_gaps(&articles),
        })
    }

    async fn identify_topic_blind_spots_live(
        &self,
        min_sources: i64,
    ) -> Result<Vec<TopicBlindSpotResponse>, BlindspotAnalysisError> {
        let since = analysis_since(7);
        let active_sources = self
            .database
            .list_active_source_names(since)
            .await
            .map_err(database_analysis_error)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        if active_sources.is_empty() {
            return Ok(Vec::new());
        }
        let clusters = load_live_topic_clusters(
            &self.database,
            &self.chroma,
            &self.embeddings,
            since,
            GENERAL_TOPIC_ARTICLE_LIMIT,
            TOPIC_RESULT_LIMIT,
        )
        .await?;
        let topics =
            load_live_topic_details(&self.database, clusters, Some(&active_sources)).await?;
        let mut topics = topics
            .into_iter()
            .filter(|topic| {
                topic.covering_sources.len() >= min_sources as usize
                    && !topic.blind_spot_sources.is_empty()
            })
            .map(topic_response)
            .collect::<Result<Vec<_>, _>>()?;
        topics.sort_by(|left, right| {
            topic_severity_rank(&left.severity)
                .cmp(&topic_severity_rank(&right.severity))
                .then(left.cluster_id.cmp(&right.cluster_id))
        });
        Ok(topics)
    }

    async fn generate_source_coverage_report_live(
        &self,
        days: i64,
    ) -> Result<CoverageReportResponse, BlindspotAnalysisError> {
        let since = analysis_since(days);
        let articles = self
            .database
            .list_blindspot_source_articles(None, since)
            .await
            .map_err(database_analysis_error)?;
        let mut articles_by_source = BTreeMap::new();
        for article in articles {
            if let Some(source) = article
                .source
                .as_deref()
                .filter(|source| !source.is_empty())
            {
                articles_by_source
                    .entry(source.to_owned())
                    .or_insert_with(Vec::new)
                    .push(article);
            }
        }
        let topics = if articles_by_source.is_empty() {
            Vec::new()
        } else {
            let clusters = load_live_topic_clusters(
                &self.database,
                &self.chroma,
                &self.embeddings,
                since,
                SOURCE_TOPIC_ARTICLE_LIMIT,
                SOURCE_TOPIC_RESULT_LIMIT,
            )
            .await?;
            load_live_topic_details(&self.database, clusters, None).await?
        };

        let mut source_rankings = Vec::with_capacity(articles_by_source.len());
        let mut underperforming_sources = Vec::new();
        let mut coverage_total = 0.0;
        let mut article_total = 0.0;
        for (source, source_articles) in &articles_by_source {
            let source_article_ids = source_articles
                .iter()
                .map(|article| article.id)
                .collect::<HashSet<_>>();
            let topics_covered = topics
                .iter()
                .filter(|topic| {
                    topic
                        .member_ids
                        .iter()
                        .any(|article_id| source_article_ids.contains(article_id))
                })
                .count();
            let coverage_ratio = topics_covered as f64 / topics.len().max(1) as f64;
            let article_count = i64::try_from(source_articles.len()).map_err(|_| {
                BlindspotAnalysisError::Failed("source article count overflowed".into())
            })?;
            coverage_total += coverage_ratio;
            article_total += article_count as f64;
            let blind_spots = source_blind_spot_values(&topics, &source_article_ids);
            source_rankings.push(json!({
                "source": source,
                "coverage_ratio": coverage_ratio,
                "topics_covered": topics_covered,
                "article_count": article_count,
                "blind_spot_count": blind_spots.len(),
            }));
            if coverage_ratio < 0.5 {
                underperforming_sources.push(json!({
                    "source": source,
                    "coverage_ratio": coverage_ratio,
                    "blind_spots": blind_spots.into_iter().take(5).collect::<Vec<_>>(),
                }));
            }
        }
        let source_count = i64::try_from(articles_by_source.len())
            .map_err(|_| BlindspotAnalysisError::Failed("source count overflowed".into()))?;
        let average_coverage_ratio = if source_count == 0 {
            0.0
        } else {
            round_decimal(coverage_total / source_count as f64, 100.0)
        };
        let average_articles_per_source = if source_count == 0 {
            0.0
        } else {
            round_decimal(article_total / source_count as f64, 10.0)
        };
        let systemic_blind_spots = self
            .identify_topic_blind_spots_live(4)
            .await?
            .into_iter()
            .take(10)
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| BlindspotAnalysisError::Failed(error.to_string()))?;
        Ok(CoverageReportResponse {
            report_period_days: days,
            generated_at: format_utc_timestamp(Utc::now().naive_utc()),
            total_sources: source_count,
            average_coverage_ratio,
            average_articles_per_source,
            source_rankings,
            systemic_blind_spots,
            underperforming_sources,
        })
    }

    async fn update_daily_coverage_stats_live(&self) -> Result<i64, BlindspotAnalysisError> {
        let today = Utc::now().date_naive();
        let daily_articles = self
            .database
            .list_daily_article_coverage(today)
            .await
            .map_err(database_analysis_error)?;
        if daily_articles.is_empty() {
            return Ok(0);
        }
        let health = self
            .embeddings
            .health()
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?;
        if !health.ok {
            return Err(BlindspotAnalysisError::Unavailable);
        }
        let collection = self
            .chroma
            .get_collection()
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?;
        if collection
            .count()
            .await
            .map_err(|_| BlindspotAnalysisError::Unavailable)?
            == 0
        {
            return Err(BlindspotAnalysisError::Unavailable);
        }
        let article_ids = daily_articles
            .iter()
            .flat_map(|record| record.article_ids.iter().copied())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut embedded_ids = HashSet::new();
        for batch in article_ids.chunks(CHROMA_GET_BATCH_SIZE) {
            let response = collection
                .get(ChromaGetRequest {
                    ids: Some(
                        batch
                            .iter()
                            .map(|article_id| format!("article_{article_id}"))
                            .collect(),
                    ),
                    ..ChromaGetRequest::default()
                })
                .await
                .map_err(|_| BlindspotAnalysisError::Unavailable)?;
            embedded_ids.extend(
                response
                    .ids
                    .iter()
                    .filter_map(|chroma_id| parse_chroma_article_id(chroma_id)),
            );
        }
        let records = daily_articles
            .into_iter()
            .map(|record| {
                let cluster_ids = record
                    .article_ids
                    .iter()
                    .copied()
                    .filter(|article_id| embedded_ids.contains(article_id))
                    .collect::<Vec<_>>();
                let topics_covered = i64::try_from(cluster_ids.len()).map_err(|_| {
                    BlindspotAnalysisError::Failed("daily topic count overflowed".into())
                })?;
                Ok(SourceCoverageStatsWrite {
                    source_name: record.source_name,
                    date: today,
                    article_count: record.article_count,
                    article_count_by_category: record.article_count_by_category,
                    topics_covered,
                    cluster_ids: Value::Array(cluster_ids.into_iter().map(Value::from).collect()),
                })
            })
            .collect::<Result<Vec<_>, BlindspotAnalysisError>>()?;
        let updated = self
            .database
            .upsert_source_coverage_stats(&records)
            .await
            .map_err(database_analysis_error)?;
        i64::try_from(updated)
            .map_err(|_| BlindspotAnalysisError::Failed("updated source count overflowed".into()))
    }
}
fn analysis_since(days: i64) -> NaiveDateTime {
    Utc::now().naive_utc() - Duration::days(days)
}

fn format_utc_timestamp(value: NaiveDateTime) -> String {
    format!("{}+00:00", value.format("%Y-%m-%dT%H:%M:%S%.f"))
}

fn round_decimal(value: f64, precision: f64) -> f64 {
    (value * precision).round_ties_even() / precision
}

fn source_topic_is_covered(topic: &LiveTopicDetail, article_ids: &HashSet<i64>) -> bool {
    topic
        .member_ids
        .iter()
        .any(|article_id| article_ids.contains(article_id))
}

fn source_blind_spot_values(topics: &[LiveTopicDetail], article_ids: &HashSet<i64>) -> Vec<Value> {
    let mut blind_spots = topics
        .iter()
        .filter(|topic| !source_topic_is_covered(topic, article_ids))
        .map(|topic| {
            json!({
                "cluster_id": topic.cluster_id,
                "cluster_label": topic.label,
                "topic_keywords": topic.keywords,
                "total_articles": topic.article_count,
                "severity": source_blind_spot_severity(topic.article_count),
            })
        })
        .collect::<Vec<_>>();
    blind_spots.sort_by(|left, right| {
        right["severity"]
            .as_str()
            .unwrap_or_default()
            .cmp(left["severity"].as_str().unwrap_or_default())
    });
    blind_spots.truncate(20);
    blind_spots
}

fn source_blind_spot_severity(article_count: i64) -> &'static str {
    if article_count >= 20 {
        "high"
    } else if article_count >= 10 {
        "medium"
    } else {
        "low"
    }
}

fn topic_blind_spot_severity(
    covering_count: i64,
    blind_count: i64,
    article_count: i64,
) -> &'static str {
    let source_count = covering_count + blind_count;
    let blind_ratio = if source_count > 0 {
        blind_count as f64 / source_count as f64
    } else {
        0.0
    };
    if article_count >= 15 && covering_count >= 6 && blind_ratio >= 0.4 {
        "high"
    } else if article_count >= 8 && covering_count >= 3 && blind_ratio >= 0.25 {
        "medium"
    } else {
        "low"
    }
}

fn topic_response(
    topic: LiveTopicDetail,
) -> Result<TopicBlindSpotResponse, BlindspotAnalysisError> {
    let covering_count = i64::try_from(topic.covering_sources.len())
        .map_err(|_| BlindspotAnalysisError::Failed("covering source count overflowed".into()))?;
    let blind_spot_count = i64::try_from(topic.blind_spot_sources.len())
        .map_err(|_| BlindspotAnalysisError::Failed("blindspot source count overflowed".into()))?;
    let severity = topic_blind_spot_severity(covering_count, blind_spot_count, topic.article_count);
    Ok(TopicBlindSpotResponse {
        cluster_id: topic.cluster_id,
        cluster_label: topic.label,
        keywords: topic.keywords,
        article_count: topic.article_count,
        covering_sources: topic.covering_sources,
        covering_count,
        blind_spot_sources: topic.blind_spot_sources,
        blind_spot_count,
        severity: severity.to_owned(),
        date_identified: format_utc_timestamp(Utc::now().naive_utc()),
    })
}

fn identify_coverage_gaps(articles: &[BlindspotSourceArticleRecord]) -> Vec<Value> {
    let mut dates = articles
        .iter()
        .filter_map(|article| article.published_at)
        .collect::<Vec<_>>();
    dates.sort_unstable();
    let mut gaps = Vec::new();
    for pair in dates.windows(2) {
        let gap_hours =
            pair[1].signed_duration_since(pair[0]).num_milliseconds() as f64 / 3_600_000.0;
        if gap_hours > 24.0 {
            gaps.push(json!({
                "start": format_utc_timestamp(pair[0]),
                "end": format_utc_timestamp(pair[1]),
                "duration_hours": round_decimal(gap_hours, 10.0),
            }));
            if gaps.len() == 5 {
                break;
            }
        }
    }
    gaps
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceBlindSpotsResponse)]
pub struct SourceBlindSpotsResponse {
    pub source: String,
    pub article_count: i64,
    pub topics_covered: i64,
    pub total_active_topics: i64,
    pub coverage_ratio: f64,
    #[schema(schema_with = free_form_object_array_schema)]
    pub blind_spots: Vec<Value>,
    #[schema(schema_with = free_form_object_array_schema)]
    pub coverage_gaps: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = TopicBlindSpotResponse)]
pub struct TopicBlindSpotResponse {
    pub cluster_id: i64,
    pub cluster_label: String,
    pub keywords: Vec<String>,
    pub article_count: i64,
    pub covering_sources: Vec<String>,
    pub covering_count: i64,
    pub blind_spot_sources: Vec<String>,
    pub blind_spot_count: i64,
    pub severity: String,
    pub date_identified: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = CoverageReportResponse)]
pub struct CoverageReportResponse {
    pub report_period_days: i64,
    pub generated_at: String,
    pub total_sources: i64,
    pub average_coverage_ratio: f64,
    pub average_articles_per_source: f64,
    #[schema(schema_with = free_form_object_array_schema)]
    pub source_rankings: Vec<Value>,
    #[schema(schema_with = free_form_object_array_schema)]
    pub systemic_blind_spots: Vec<Value>,
    #[schema(schema_with = free_form_object_array_schema)]
    pub underperforming_sources: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct BlindspotDashboardSummaryResponse {
    total_sources: i64,
    average_coverage: f64,
    high_severity_blind_spots: i64,
    medium_severity_blind_spots: i64,
    underperforming_sources: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CoverageDistributionResponse {
    excellent: i64,
    good: i64,
    fair: i64,
    poor: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotDashboardResponse)]
pub(crate) struct BlindspotDashboardResponse {
    summary: BlindspotDashboardSummaryResponse,
    coverage_distribution: CoverageDistributionResponse,
    top_blind_spots: Vec<TopicBlindSpotResponse>,
    #[schema(schema_with = free_form_object_array_schema)]
    underperforming_sources: Vec<Value>,
    last_updated: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotStatsUpdateResponse)]
pub(crate) struct BlindspotStatsUpdateResponse {
    success: bool,
    sources_updated: i64,
    timestamp: String,
}

fn free_form_object_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(
            ObjectBuilder::new()
                .schema_type(Type::Object)
                .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                .build(),
        )
        .build()
        .into()
}

const MIN_CLUSTER_ARTICLES: usize = 3;
const MIN_CLUSTER_SOURCES: usize = 4;
const DEFAULT_PER_LANE: i64 = 10;
const MAX_CARD_ARTICLES: usize = 8;
const BLINDSPOT_SHARE_GAP: f64 = 0.35;
const SEMAXIS_UNAVAILABLE_REASON: &str = "Stored embeddings were unavailable for the SemAxis lens.";
const INITIALIZING_REASON: &str = "Topic clusters are still initializing.";

const GLOBAL_NORTH_COUNTRY_CODES: &[&str] = &[
    "US", "CA", "GB", "IE", "AU", "NZ", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "CH", "AT", "SE",
    "NO", "DK", "FI", "IS", "LU", "JP", "KR", "SG", "TW", "HK", "IL",
];

#[derive(Clone, Copy, Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[schema(rename_all = "snake_case")]
enum BlindspotLensId {
    Bias,
    Credibility,
    Geography,
    InstitutionalPopulist,
}

impl BlindspotLensId {
    const ALL: [Self; 4] = [
        Self::Bias,
        Self::Credibility,
        Self::Geography,
        Self::InstitutionalPopulist,
    ];

    fn parse(value: &str) -> Option<Self> {
        match value {
            "bias" => Some(Self::Bias),
            "credibility" => Some(Self::Credibility),
            "geography" => Some(Self::Geography),
            "institutional_populist" => Some(Self::InstitutionalPopulist),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[schema(rename_all = "snake_case")]
enum BlindspotLaneId {
    PoleA,
    Shared,
    PoleB,
}

impl BlindspotLaneId {
    const ALL: [Self; 3] = [Self::PoleA, Self::Shared, Self::PoleB];

    fn index(self) -> usize {
        match self {
            Self::PoleA => 0,
            Self::Shared => 1,
            Self::PoleB => 2,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotLensResponse)]
struct BlindspotLensResponse {
    id: BlindspotLensId,
    label: String,
    description: String,
    available: bool,
    unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotLaneResponse)]
struct BlindspotLaneResponse {
    id: BlindspotLaneId,
    label: String,
    description: String,
    cluster_count: usize,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotCoverageCountsResponse)]
struct BlindspotCoverageCountsResponse {
    pole_a: usize,
    shared: usize,
    pole_b: usize,
}

impl BlindspotCoverageCountsResponse {
    fn total(&self) -> usize {
        self.pole_a + self.shared + self.pole_b
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotCoverageSharesResponse)]
struct BlindspotCoverageSharesResponse {
    pole_a: f64,
    shared: f64,
    pole_b: f64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotGeographySignalResponse)]
struct BlindspotGeographySignalResponse {
    id: String,
    label: String,
    count: usize,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = PaywallConcentrationResponse)]
struct PaywallConcentrationResponse {
    total_articles: usize,
    paywalled_articles: usize,
    free_articles: usize,
    unknown_articles: usize,
    paywall_share: f64,
    status: String,
    best_free_sources: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotPreviewArticleResponse)]
struct BlindspotPreviewArticleResponse {
    id: i64,
    title: String,
    source: String,
    source_id: Option<String>,
    url: String,
    image_url: Option<String>,
    published_at: Option<String>,
    summary: Option<String>,
    similarity: f64,
    country: Option<String>,
    source_country: Option<String>,
    category: Option<String>,
    bias: Option<String>,
    credibility: Option<String>,
    author: Option<String>,
    authors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotCardResponse)]
struct BlindspotCardResponse {
    cluster_id: i64,
    cluster_label: String,
    keywords: Vec<String>,
    article_count: usize,
    source_count: usize,
    lane: BlindspotLaneId,
    blindspot_score: f64,
    balance_score: f64,
    published_at: Option<String>,
    explanation: String,
    coverage_counts: BlindspotCoverageCountsResponse,
    coverage_shares: BlindspotCoverageSharesResponse,
    representative_article: Option<BlindspotPreviewArticleResponse>,
    articles: Vec<BlindspotPreviewArticleResponse>,
    geography_signals: Vec<BlindspotGeographySignalResponse>,
    paywall_concentration: PaywallConcentrationResponse,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotViewerSummaryResponse)]
struct BlindspotViewerSummaryResponse {
    window: String,
    total_clusters: usize,
    eligible_clusters: usize,
    generated_at: String,
    category: Option<String>,
    source_filters: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BlindspotViewerResponse)]
pub(crate) struct BlindspotViewerResponse {
    available_lenses: Vec<BlindspotLensResponse>,
    selected_lens: BlindspotLensResponse,
    summary: BlindspotViewerSummaryResponse,
    lanes: Vec<BlindspotLaneResponse>,
    cards: Vec<BlindspotCardResponse>,
    status: String,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct BlindspotViewerParameters {
    #[param(default = "bias")]
    lens: Option<BlindspotLensId>,
    #[param(pattern = "^(1d|1w|1m)$", default = "1w")]
    window: Option<String>,
    #[param(nullable = true)]
    category: Option<String>,
    #[param(nullable = true)]
    sources: Option<String>,
    #[param(minimum = 1, maximum = 20, default = 10)]
    per_lane: Option<i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct BlindspotSourceQueryParameters {
    #[param(minimum = 1, maximum = 90, default = 30)]
    days: Option<i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct BlindspotTopicsQueryParameters {
    #[param(minimum = 2, maximum = 20, default = 4)]
    min_sources: Option<i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct BlindspotReportQueryParameters {
    #[param(minimum = 7, maximum = 90, default = 30)]
    days: Option<i64>,
}

#[derive(Clone, Copy)]
struct LensDefinition {
    id: BlindspotLensId,
    label: &'static str,
    description: &'static str,
    pole_a_name: &'static str,
    pole_b_name: &'static str,
    pole_a_lane_label: &'static str,
    pole_a_lane_description: &'static str,
    shared_lane_label: &'static str,
    shared_lane_description: &'static str,
    pole_b_lane_label: &'static str,
    pole_b_lane_description: &'static str,
}

impl LensDefinition {
    fn for_lens(id: BlindspotLensId) -> Self {
        match id {
            BlindspotLensId::Bias => Self {
                id,
                label: "Left vs Right",
                description: "Compare which story clusters the left, center, and right are covering.",
                pole_a_name: "left-leaning",
                pole_b_name: "right-leaning",
                pole_a_lane_label: "For the Left",
                pole_a_lane_description: "Stories getting little or no coverage from left-leaning sources.",
                shared_lane_label: "Shared Coverage",
                shared_lane_description: "Stories drawing coverage from both poles or from center outlets.",
                pole_b_lane_label: "For the Right",
                pole_b_lane_description: "Stories getting little or no coverage from right-leaning sources.",
            },
            BlindspotLensId::Credibility => Self {
                id,
                label: "Credible vs Uncredible",
                description: "Compare higher-trust coverage against mixed or low-factual-reporting coverage, with unknown outlets treated as the middle band.",
                pole_a_name: "high-credibility",
                pole_b_name: "low-credibility",
                pole_a_lane_label: "For High Credibility",
                pole_a_lane_description: "Stories showing up on lower-trust outlets while higher-trust coverage stays thin.",
                shared_lane_label: "Shared Coverage",
                shared_lane_description: "Stories carried across trust tiers or concentrated in the unknown middle band.",
                pole_b_lane_label: "For Low Credibility",
                pole_b_lane_description: "Stories emphasized by higher-credibility outlets but thin on lower-credibility ones.",
            },
            BlindspotLensId::Geography => Self {
                id,
                label: "Global North vs Global South",
                description: "Compare coverage from source countries grouped into an operational Global North and Global South split.",
                pole_a_name: "global-north",
                pole_b_name: "global-south",
                pole_a_lane_label: "For the Global North",
                pole_a_lane_description: "Stories drawing Global South coverage while Global North sources stay thin.",
                shared_lane_label: "Shared Coverage",
                shared_lane_description: "Stories appearing across both regional blocs.",
                pole_b_lane_label: "For the Global South",
                pole_b_lane_description: "Stories drawing Global North coverage while Global South sources stay thin.",
            },
            BlindspotLensId::InstitutionalPopulist => Self {
                id,
                label: "Institutional vs Populist",
                description: "A SemAxis lens over article embeddings that compares establishment framing against grassroots and outsider framing.",
                pole_a_name: "institutional",
                pole_b_name: "populist",
                pole_a_lane_label: "For Institutional",
                pole_a_lane_description: "Stories leaning populist in framing while institutional coverage stays thin.",
                shared_lane_label: "Shared Coverage",
                shared_lane_description: "Stories with mixed framing across the cluster.",
                pole_b_lane_label: "For Populist",
                pole_b_lane_description: "Stories leaning institutional in framing while populist coverage stays thin.",
            },
        }
    }

    fn response(self, available: bool, unavailable_reason: Option<&str>) -> BlindspotLensResponse {
        BlindspotLensResponse {
            id: self.id,
            label: self.label.to_owned(),
            description: self.description.to_owned(),
            available,
            unavailable_reason: unavailable_reason.map(str::to_owned),
        }
    }
}

#[derive(Clone, Copy)]
struct SnapshotArticle<'a> {
    payload: &'a Value,
    database: Option<&'a BlindspotArticleRecord>,
}

impl<'a> SnapshotArticle<'a> {
    fn payload_text(&self, key: &str) -> Option<&'a str> {
        self.payload.get(key).and_then(Value::as_str)
    }

    fn source_name(&self) -> &'a str {
        if let Some(record) = self.database {
            return if has_text(&record.source) {
                record.source.as_str()
            } else {
                "unknown-source"
            };
        }
        self.payload_text("source")
            .filter(|value| has_text(value))
            .unwrap_or("unknown-source")
    }

    fn source_id(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record.source_id.as_deref();
        }
        self.payload_text("source_id")
    }

    fn category(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record.category.as_deref();
        }
        self.payload_text("category")
    }

    fn bias(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record
                .bias
                .as_deref()
                .filter(|value| has_text(value))
                .or_else(|| {
                    record
                        .source_bias
                        .as_deref()
                        .filter(|value| has_text(value))
                });
        }
        self.payload_text("bias").filter(|value| has_text(value))
    }

    fn credibility(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record
                .credibility
                .as_deref()
                .filter(|value| has_text(value))
                .or_else(|| {
                    record
                        .source_factual_reporting
                        .as_deref()
                        .filter(|value| has_text(value))
                });
        }
        self.payload_text("credibility")
            .filter(|value| has_text(value))
    }

    fn source_country(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record
                .source_country
                .as_deref()
                .filter(|value| has_text(value));
        }
        self.payload_text("source_country")
            .filter(|value| has_text(value))
    }

    fn country(&self) -> Option<&'a str> {
        if let Some(record) = self.database {
            return record.country.as_deref().filter(|value| has_text(value));
        }
        self.payload_text("country").filter(|value| has_text(value))
    }

    fn country_code(&self) -> Option<&'a str> {
        self.source_country()
            .or_else(|| self.country())
            .or_else(|| {
                if self.database.is_some() {
                    return None;
                }
                snapshot_container_value(
                    self.payload,
                    &["geo", "geography"],
                    &["source_country", "country_code"],
                )
            })
            .or_else(|| {
                if self.database.is_some() {
                    return None;
                }
                snapshot_container_value(
                    self.payload,
                    &["baseline", "geo_baseline"],
                    &["baseline_country", "country_code", "country"],
                )
            })
    }

    fn paywall_status(&self) -> &'a str {
        if let Some(record) = self.database {
            return record
                .paywall_status
                .as_deref()
                .filter(|value| has_text(value))
                .unwrap_or("unknown");
        }
        self.payload_text("paywall_status")
            .filter(|value| has_text(value))
            .unwrap_or("unknown")
    }

    fn published_at(&self) -> Option<String> {
        if let Some(record) = self.database {
            return record.published_at.map(format_timestamp);
        }
        self.payload_text("published_at").map(str::to_owned)
    }

    fn source_filter_aliases(&self) -> [String; 3] {
        let source_name = self.source_name();
        [
            source_name.to_lowercase(),
            slugify(source_name),
            self.source_id()
                .filter(|value| has_text(value))
                .unwrap_or_default()
                .trim()
                .to_lowercase(),
        ]
    }

    fn preview_source_key(&self) -> String {
        self.payload_text("source_id")
            .filter(|value| has_text(value))
            .map(|value| value.trim().to_lowercase())
            .unwrap_or_else(|| slugify(self.payload_text("source").unwrap_or("unknown-source")))
    }

    fn unique_source_key(&self) -> String {
        self.source_id()
            .filter(|value| has_text(value))
            .map(|value| value.trim().to_lowercase())
            .unwrap_or_else(|| slugify(self.source_name()))
    }

    fn distinct_source_value(&self) -> String {
        self.source_id()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| slugify(self.source_name()))
    }

    fn matches_source_filter(&self, selected_sources: &BTreeSet<String>) -> bool {
        selected_sources.is_empty()
            || self
                .source_filter_aliases()
                .iter()
                .any(|alias| !alias.is_empty() && selected_sources.contains(alias))
    }

    fn matches_category(&self, category: Option<&str>) -> bool {
        category.is_none_or(|category| {
            self.category()
                .is_some_and(|value| value.eq_ignore_ascii_case(category))
        })
    }

    fn geography_signal(&self) -> Option<(&'static str, &'static str)> {
        if self.source_country().is_some() {
            return Some(("source_country", "Source country"));
        }
        if self.database.is_none() {
            if snapshot_container_value(
                self.payload,
                &["geo", "geography"],
                &["source_country", "country_code"],
            )
            .is_some()
            {
                return Some(("source_country", "Source country"));
            }
            if snapshot_container_value(
                self.payload,
                &["baseline", "geo_baseline"],
                &["baseline_country", "country_code", "country"],
            )
            .is_some()
            {
                return Some(("baseline_country", "Baseline country"));
            }
        }
        self.country().map(|_| ("country", "Article country"))
    }

    fn preview(&self) -> BlindspotPreviewArticleResponse {
        let authors = self
            .payload
            .get("authors")
            .and_then(Value::as_array)
            .map(|authors| {
                authors
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        BlindspotPreviewArticleResponse {
            id: self
                .payload
                .get("id")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            title: self
                .payload_text("title")
                .unwrap_or("Untitled article")
                .to_owned(),
            source: self.payload_text("source").unwrap_or("Unknown").to_owned(),
            source_id: self.payload_text("source_id").map(str::to_owned),
            url: self.payload_text("url").unwrap_or_default().to_owned(),
            image_url: self.payload_text("image_url").map(str::to_owned),
            published_at: self.payload_text("published_at").map(str::to_owned),
            summary: self.payload_text("summary").map(str::to_owned),
            similarity: self
                .payload
                .get("similarity")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .unwrap_or(1.0),
            country: self.payload_text("country").map(str::to_owned),
            source_country: self.payload_text("source_country").map(str::to_owned),
            category: self.payload_text("category").map(str::to_owned),
            bias: self.payload_text("bias").map(str::to_owned),
            credibility: self.payload_text("credibility").map(str::to_owned),
            author: self.payload_text("author").map(str::to_owned),
            authors,
        }
    }
}

struct SnapshotCluster<'a> {
    cluster_id: i64,
    label: Option<&'a str>,
    keywords: Vec<String>,
    articles: &'a [Value],
}

#[derive(Clone, Debug)]
struct CardCandidate {
    card: BlindspotCardResponse,
    lane_score: f64,
}

/// Build live-analysis routes plus the persisted-snapshot blindspot viewer.
pub(crate) fn router(state: BlindspotAnalysisState) -> Router<AppState> {
    Router::new()
        .merge(analysis_router(state))
        .route("/blindspots/viewer", get(get_blindspot_viewer))
}

fn analysis_router(state: BlindspotAnalysisState) -> Router<AppState> {
    Router::new()
        .route(
            "/blindspots/source/{source_name}",
            get(get_source_blind_spots),
        )
        .route("/blindspots/topics", get(get_topic_blind_spots))
        .route("/blindspots/report", get(get_coverage_report))
        .route("/blindspots/dashboard", get(get_blind_spots_dashboard))
        .route("/blindspots/update-stats", post(update_coverage_stats))
        .layer(Extension(state))
}

#[utoipa::path(
    get,
    path = "/blindspots/source/{source_name}",
    operation_id = "get_source_blind_spots_blindspots_source__source_name__get",
    tag = "blindspots",
    summary = "Get Source Blind Spots",
    description = "Analyze one source's live topic coverage and temporal gaps.",
    params(
        ("source_name" = String, Path, description = "Name of the news source"),
        BlindspotSourceQueryParameters
    ),
    responses(
        (status = 200, description = "Successful Response", body = SourceBlindSpotsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_source_blind_spots(
    Extension(state): Extension<BlindspotAnalysisState>,
    Path(source_name): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let days = match parse_integer_query(&params, "days", 30, 1, 90) {
        Ok(days) => days,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return blindspot_unavailable_response();
    };
    let mut result = match provider.analyze_source_coverage(source_name, days).await {
        Ok(result) => result,
        Err(error) => return blindspot_provider_error(error, "Failed to analyze source coverage"),
    };
    if result.article_count <= 0
        || result.topics_covered < 0
        || result.total_active_topics < 0
        || !result.coverage_ratio.is_finite()
        || sort_source_blind_spots(&mut result.blind_spots).is_err()
    {
        return blindspot_invalid_result("Failed to analyze source coverage");
    }
    result.blind_spots.truncate(20);
    result.coverage_gaps.truncate(5);
    Json(result).into_response()
}

#[utoipa::path(
    get,
    path = "/blindspots/topics",
    operation_id = "get_topic_blind_spots_blindspots_topics_get",
    tag = "blindspots",
    summary = "Get Topic Blind Spots",
    description = "Find live topic clusters that meet the source-coverage threshold.",
    params(BlindspotTopicsQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = [TopicBlindSpotResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_topic_blind_spots(
    Extension(state): Extension<BlindspotAnalysisState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let min_sources = match parse_integer_query(&params, "min_sources", 4, 2, 20) {
        Ok(min_sources) => min_sources,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return blindspot_unavailable_response();
    };
    let mut results = match provider.identify_topic_blind_spots(min_sources).await {
        Ok(results) => results,
        Err(error) => {
            return blindspot_provider_error(error, "Failed to identify topic blind spots")
        }
    };
    sort_topic_blind_spots(&mut results);
    Json(results).into_response()
}

#[utoipa::path(
    get,
    path = "/blindspots/report",
    operation_id = "get_coverage_report_blindspots_report_get",
    tag = "blindspots",
    summary = "Get Coverage Report",
    description = "Generate source coverage rankings and systemic blindspots.",
    params(BlindspotReportQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = CoverageReportResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_coverage_report(
    Extension(state): Extension<BlindspotAnalysisState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let days = match parse_integer_query(&params, "days", 30, 7, 90) {
        Ok(days) => days,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return blindspot_unavailable_response();
    };
    let mut result = match provider.generate_source_coverage_report(days).await {
        Ok(result) => result,
        Err(error) => return blindspot_provider_error(error, "Failed to generate coverage report"),
    };
    if result.total_sources < 0
        || !result.average_coverage_ratio.is_finite()
        || !result.average_articles_per_source.is_finite()
        || sort_source_rankings(&mut result.source_rankings).is_err()
        || sort_source_rankings(&mut result.underperforming_sources).is_err()
    {
        return blindspot_invalid_result("Failed to generate coverage report");
    }
    Json(result).into_response()
}

#[utoipa::path(
    get,
    path = "/blindspots/dashboard",
    operation_id = "get_blind_spots_dashboard_blindspots_dashboard_get",
    tag = "blindspots",
    summary = "Get Blind Spots Dashboard",
    description = "Combine the live seven-day coverage report and topic analysis.",
    responses((status = 200, description = "Successful Response", body = BlindspotDashboardResponse))
)]
pub(crate) async fn get_blind_spots_dashboard(
    Extension(state): Extension<BlindspotAnalysisState>,
) -> Response {
    let Some(provider) = state.provider else {
        return blindspot_unavailable_response();
    };
    let mut report = match provider.generate_source_coverage_report(7).await {
        Ok(report) => report,
        Err(error) => return blindspot_provider_error(error, "Failed to generate dashboard"),
    };
    let mut topics = match provider.identify_topic_blind_spots(4).await {
        Ok(topics) => topics,
        Err(error) => return blindspot_provider_error(error, "Failed to generate dashboard"),
    };
    if report.total_sources < 0
        || !report.average_coverage_ratio.is_finite()
        || !report.average_articles_per_source.is_finite()
        || sort_source_rankings(&mut report.source_rankings).is_err()
        || sort_source_rankings(&mut report.underperforming_sources).is_err()
    {
        return blindspot_invalid_result("Failed to generate dashboard");
    }
    sort_topic_blind_spots(&mut topics);
    let distribution = match coverage_distribution(&report.source_rankings) {
        Ok(distribution) => distribution,
        Err(()) => return blindspot_invalid_result("Failed to generate dashboard"),
    };
    let high_severity = match count_topics_with_severity(&topics, "high") {
        Some(count) => count,
        None => return blindspot_invalid_result("Failed to generate dashboard"),
    };
    let medium_severity = match count_topics_with_severity(&topics, "medium") {
        Some(count) => count,
        None => return blindspot_invalid_result("Failed to generate dashboard"),
    };
    let underperforming_count = match i64::try_from(report.underperforming_sources.len()) {
        Ok(count) => count,
        Err(_) => return blindspot_invalid_result("Failed to generate dashboard"),
    };
    let response = BlindspotDashboardResponse {
        summary: BlindspotDashboardSummaryResponse {
            total_sources: report.total_sources,
            average_coverage: (report.average_coverage_ratio * 1000.0).round_ties_even() / 10.0,
            high_severity_blind_spots: high_severity,
            medium_severity_blind_spots: medium_severity,
            underperforming_sources: underperforming_count,
        },
        coverage_distribution: distribution,
        top_blind_spots: topics.into_iter().take(5).collect(),
        underperforming_sources: report.underperforming_sources.into_iter().take(5).collect(),
        last_updated: Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string(),
    };
    Json(response).into_response()
}

#[utoipa::path(
    post,
    path = "/blindspots/update-stats",
    operation_id = "update_coverage_stats_blindspots_update_stats_post",
    tag = "blindspots",
    summary = "Update Coverage Stats",
    description = "Persist today's source coverage statistics.",
    responses((status = 200, description = "Successful Response", body = BlindspotStatsUpdateResponse))
)]
pub(crate) async fn update_coverage_stats(
    Extension(state): Extension<BlindspotAnalysisState>,
) -> Response {
    let Some(provider) = state.provider else {
        return blindspot_unavailable_response();
    };
    match provider.update_daily_coverage_stats().await {
        Ok(sources_updated) if sources_updated >= 0 => Json(BlindspotStatsUpdateResponse {
            success: true,
            sources_updated,
            timestamp: Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string(),
        })
        .into_response(),
        Ok(_) => blindspot_invalid_result("Failed to update coverage stats"),
        Err(error) => blindspot_provider_error(error, "Failed to update coverage stats"),
    }
}

fn sort_source_blind_spots(blind_spots: &mut [Value]) -> Result<(), ()> {
    if blind_spots
        .iter()
        .any(|blind_spot| blind_spot.get("severity").and_then(Value::as_str).is_none())
    {
        return Err(());
    }
    blind_spots.sort_by(|left, right| {
        let left = left["severity"].as_str().unwrap_or_default();
        let right = right["severity"].as_str().unwrap_or_default();
        right.cmp(left)
    });
    Ok(())
}

fn sort_topic_blind_spots(topics: &mut [TopicBlindSpotResponse]) {
    topics.sort_by(|left, right| {
        topic_severity_rank(&left.severity).cmp(&topic_severity_rank(&right.severity))
    });
}

fn topic_severity_rank(severity: &str) -> u8 {
    match severity {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 3,
    }
}

fn sort_source_rankings(rankings: &mut [Value]) -> Result<(), ()> {
    if rankings.iter().any(|ranking| {
        ranking
            .get("coverage_ratio")
            .and_then(Value::as_f64)
            .is_none_or(|ratio| !ratio.is_finite())
    }) {
        return Err(());
    }

    rankings.sort_by(|left, right| {
        let left_ratio = left["coverage_ratio"].as_f64().unwrap_or_default();
        let right_ratio = right["coverage_ratio"].as_f64().unwrap_or_default();
        right_ratio.total_cmp(&left_ratio)
    });
    Ok(())
}

fn coverage_distribution(rankings: &[Value]) -> Result<CoverageDistributionResponse, ()> {
    let mut distribution = CoverageDistributionResponse {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
    };
    for ranking in rankings {
        let ratio = ranking
            .get("coverage_ratio")
            .and_then(Value::as_f64)
            .filter(|ratio| ratio.is_finite())
            .ok_or(())?;
        let count = if ratio >= 0.8 {
            &mut distribution.excellent
        } else if ratio >= 0.6 {
            &mut distribution.good
        } else if ratio >= 0.4 {
            &mut distribution.fair
        } else {
            &mut distribution.poor
        };
        *count = count.checked_add(1).ok_or(())?;
    }
    Ok(distribution)
}

fn count_topics_with_severity(topics: &[TopicBlindSpotResponse], severity: &str) -> Option<i64> {
    i64::try_from(
        topics
            .iter()
            .filter(|topic| topic.severity == severity)
            .count(),
    )
    .ok()
}

fn blindspot_unavailable_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": "Blindspot analysis provider is not available"})),
    )
        .into_response()
}

fn blindspot_provider_error(error: BlindspotAnalysisError, context: &str) -> Response {
    match error {
        BlindspotAnalysisError::Unavailable => blindspot_unavailable_response(),
        BlindspotAnalysisError::Failed(detail) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"detail": format!("{context}: {detail}")})),
        )
            .into_response(),
    }
}

fn blindspot_invalid_result(context: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": format!("{context}: provider returned invalid result")})),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/blindspots/viewer",
    operation_id = "get_blindspot_viewer_blindspots_viewer_get",
    tag = "blindspots",
    summary = "Get Blindspot Viewer",
    description = "Get a multi-lens blindspot viewer payload.",
    params(BlindspotViewerParameters),
    responses(
        (status = 200, description = "Successful Response", body = BlindspotViewerResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_blindspot_viewer(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let lens = match parse_lens(&params) {
        Ok(lens) => lens,
        Err(error) => return error.into_response(),
    };
    let window = match parse_window(&params) {
        Ok(window) => window,
        Err(error) => return error.into_response(),
    };
    let per_lane = match parse_integer_query(&params, "per_lane", DEFAULT_PER_LANE, 1, 20) {
        Ok(per_lane) => per_lane,
        Err(error) => return error.into_response(),
    };
    let category = normalize_category(params.get("category").cloned());
    let selected_sources = normalize_source_filters(params.get("sources").map(String::as_str));

    let snapshot = match state.database.load_latest_topic_snapshot(&window).await {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            return Json(initializing_viewer(
                lens,
                &window,
                category,
                selected_sources,
            ))
            .into_response();
        }
        Err(error) => {
            tracing::error!(%error, "blindspot topic snapshot query failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let clusters = match parse_snapshot_clusters(&snapshot.clusters_json) {
        Ok(clusters) => clusters,
        Err(error) => {
            tracing::error!(%error, "blindspot topic snapshot has invalid cluster data");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let article_ids = snapshot_article_ids(&clusters);
    let articles = match state.database.load_blindspot_articles(&article_ids).await {
        Ok(articles) => articles,
        Err(error) => {
            tracing::error!(%error, "blindspot article backfill query failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    match build_viewer_payload(
        lens,
        category,
        &selected_sources,
        per_lane as usize,
        &snapshot,
        &clusters,
        &articles,
    ) {
        Ok(response) => Json(response).into_response(),
        Err(error) => {
            tracing::error!(%error, "blindspot viewer payload construction failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

fn parse_lens(params: &HashMap<String, String>) -> Result<BlindspotLensId, HttpValidationError> {
    let Some(raw) = params.get("lens") else {
        return Ok(BlindspotLensId::Bias);
    };
    BlindspotLensId::parse(raw).ok_or_else(|| {
        parameter_error(
            "lens",
            Value::String(raw.clone()),
            "literal_error",
            "Input should be 'bias', 'credibility', 'geography' or 'institutional_populist'",
            Some(Map::from_iter([(
                "expected".to_owned(),
                Value::String(
                    "'bias', 'credibility', 'geography' or 'institutional_populist'".to_owned(),
                ),
            )])),
        )
    })
}

fn parse_window(params: &HashMap<String, String>) -> Result<String, HttpValidationError> {
    let Some(raw) = params.get("window") else {
        return Ok("1w".to_owned());
    };
    if matches!(raw.as_str(), "1d" | "1w" | "1m") {
        return Ok(raw.clone());
    }
    Err(parameter_error(
        "window",
        Value::String(raw.clone()),
        "string_pattern_mismatch",
        "String should match pattern '^(1d|1w|1m)$'",
        Some(Map::from_iter([(
            "pattern".to_owned(),
            Value::String("^(1d|1w|1m)$".to_owned()),
        )])),
    ))
}

fn parse_integer_query(
    params: &HashMap<String, String>,
    field: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
) -> Result<i64, HttpValidationError> {
    let Some(raw) = params.get(field) else {
        return Ok(default);
    };
    let parsed = raw.trim().parse::<i64>().map_err(|_| {
        parameter_error(
            field,
            Value::String(raw.clone()),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
            None,
        )
    })?;
    if parsed < minimum {
        return Err(parameter_error(
            field,
            json!(parsed),
            "greater_than_equal",
            &format!("Input should be greater than or equal to {minimum}"),
            Some(Map::from_iter([("ge".to_owned(), json!(minimum))])),
        ));
    }
    if parsed > maximum {
        return Err(parameter_error(
            field,
            json!(parsed),
            "less_than_equal",
            &format!("Input should be less than or equal to {maximum}"),
            Some(Map::from_iter([("le".to_owned(), json!(maximum))])),
        ));
    }
    Ok(parsed)
}

fn parameter_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    context: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: context,
        }],
    }
}

fn normalize_category(category: Option<String>) -> Option<String> {
    category
        .map(|category| category.trim().to_owned())
        .filter(|category| !category.is_empty() && !category.eq_ignore_ascii_case("all"))
}

fn normalize_source_filters(values: Option<&str>) -> BTreeSet<String> {
    values
        .into_iter()
        .flat_map(|values| values.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn parse_snapshot_clusters(clusters_json: &Value) -> Result<Vec<SnapshotCluster<'_>>, String> {
    let raw_clusters = match clusters_json {
        Value::Null => return Ok(Vec::new()),
        Value::Array(raw_clusters) => raw_clusters,
        _ => return Err("snapshot clusters_json must be an array".to_owned()),
    };
    let mut clusters = Vec::with_capacity(raw_clusters.len());
    for (index, raw_cluster) in raw_clusters.iter().enumerate() {
        let Some(object) = raw_cluster.as_object() else {
            return Err(format!("snapshot cluster {index} must be an object"));
        };
        let Some(cluster_id) = object.get("cluster_id").and_then(Value::as_i64) else {
            continue;
        };
        let raw_articles = object.get("articles");
        let articles = match raw_articles {
            None => &[][..],
            Some(Value::Array(articles)) => articles.as_slice(),
            Some(_) => {
                return Err(format!(
                    "snapshot cluster {cluster_id} articles must be an array"
                ))
            }
        };
        if articles.iter().any(|article| !article.is_object()) {
            return Err(format!(
                "snapshot cluster {cluster_id} contains an invalid article"
            ));
        }
        let keywords = match object.get("keywords") {
            None => Vec::new(),
            Some(Value::Array(keywords)) => keywords
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            Some(_) => Vec::new(),
        };
        clusters.push(SnapshotCluster {
            cluster_id,
            label: object.get("label").and_then(Value::as_str),
            keywords,
            articles,
        });
    }
    Ok(clusters)
}

fn snapshot_article_ids(clusters: &[SnapshotCluster<'_>]) -> Vec<i64> {
    clusters
        .iter()
        .flat_map(|cluster| cluster.articles.iter())
        .filter_map(|article| article.get("id").and_then(Value::as_i64))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn build_viewer_payload(
    lens: BlindspotLensId,
    category: Option<String>,
    selected_sources: &BTreeSet<String>,
    per_lane: usize,
    snapshot: &TopicClusterSnapshotRecord,
    clusters: &[SnapshotCluster<'_>],
    database_articles: &[BlindspotArticleRecord],
) -> Result<BlindspotViewerResponse, String> {
    let article_by_id = database_articles
        .iter()
        .map(|article| (article.id, article))
        .collect::<HashMap<_, _>>();
    let mut total_clusters = 0;
    let mut eligible_clusters = 0;
    let mut trailing_articles = None;
    let mut eligible_cluster_data = Vec::new();
    let mut candidates: [Vec<CardCandidate>; 3] = std::array::from_fn(|_| Vec::new());
    let definition = LensDefinition::for_lens(lens);

    for cluster in clusters {
        total_clusters += 1;
        let mut matching_articles = Vec::new();
        let mut preview_articles = Vec::new();
        for payload in cluster.articles {
            let Some(article_id) = payload.get("id").and_then(Value::as_i64) else {
                continue;
            };
            let article = SnapshotArticle {
                payload,
                database: article_by_id.get(&article_id).copied(),
            };
            if !article.matches_category(category.as_deref())
                || !article.matches_source_filter(selected_sources)
            {
                continue;
            }
            matching_articles.push(article);
            preview_articles.push(article.preview());
        }
        trailing_articles = Some(matching_articles.clone());
        if !cluster_passes_minimums(&matching_articles) {
            continue;
        }
        eligible_clusters += 1;
        if lens != BlindspotLensId::InstitutionalPopulist {
            eligible_cluster_data.push((cluster, matching_articles, preview_articles));
        }
    }

    let trailing_articles = trailing_articles.unwrap_or_default();
    for (cluster, matching_articles, preview_articles) in eligible_cluster_data {
        let counts = metadata_counts(lens, &matching_articles);
        if counts.total() < MIN_CLUSTER_SOURCES {
            continue;
        }
        let lane = classify_lane(&counts);
        let selected_previews = select_preview_articles(&matching_articles, &preview_articles);
        let card = build_card(
            cluster,
            &matching_articles,
            &selected_previews,
            &counts,
            lane,
            definition,
            &trailing_articles,
        );
        candidates[lane.index()].push(CardCandidate {
            lane_score: card.blindspot_score,
            card,
        });
    }

    let semaxis_unavailable_reason = if eligible_clusters == 0 {
        "No articles were available for semantic scoring."
    } else {
        SEMAXIS_UNAVAILABLE_REASON
    };
    let mut cards = Vec::new();
    for lane in BlindspotLaneId::ALL {
        let lane_candidates = &mut candidates[lane.index()];
        lane_candidates.sort_by(compare_candidates);
        cards.extend(
            lane_candidates
                .drain(..)
                .take(per_lane.max(1))
                .map(|candidate| candidate.card),
        );
    }

    let available_lenses = BlindspotLensId::ALL
        .into_iter()
        .map(|id| {
            let lens_definition = LensDefinition::for_lens(id);
            if id == BlindspotLensId::InstitutionalPopulist {
                lens_definition.response(false, Some(semaxis_unavailable_reason))
            } else {
                lens_definition.response(true, None)
            }
        })
        .collect();
    let selected_lens = if lens == BlindspotLensId::InstitutionalPopulist {
        definition.response(false, Some(semaxis_unavailable_reason))
    } else {
        definition.response(true, None)
    };
    Ok(BlindspotViewerResponse {
        available_lenses,
        selected_lens,
        summary: BlindspotViewerSummaryResponse {
            window: snapshot.window.clone(),
            total_clusters,
            eligible_clusters,
            generated_at: format_timestamp(snapshot.computed_at),
            category,
            source_filters: selected_sources.iter().cloned().collect(),
        },
        lanes: lane_payloads(definition, &cards),
        cards,
        status: "ok".to_owned(),
    })
}

fn initializing_viewer(
    lens: BlindspotLensId,
    window: &str,
    category: Option<String>,
    selected_sources: BTreeSet<String>,
) -> BlindspotViewerResponse {
    let definition = LensDefinition::for_lens(lens);
    let available_lenses = BlindspotLensId::ALL
        .into_iter()
        .map(|id| {
            let lens_definition = LensDefinition::for_lens(id);
            if id == BlindspotLensId::InstitutionalPopulist {
                lens_definition.response(false, Some(INITIALIZING_REASON))
            } else {
                lens_definition.response(true, None)
            }
        })
        .collect();
    BlindspotViewerResponse {
        available_lenses,
        selected_lens: definition.response(false, Some(INITIALIZING_REASON)),
        summary: BlindspotViewerSummaryResponse {
            window: window.to_owned(),
            total_clusters: 0,
            eligible_clusters: 0,
            generated_at: format_timestamp(chrono::Utc::now().naive_utc()),
            category,
            source_filters: selected_sources.into_iter().collect(),
        },
        lanes: lane_payloads(definition, &[]),
        cards: Vec::new(),
        status: "initializing".to_owned(),
    }
}

fn cluster_passes_minimums(articles: &[SnapshotArticle<'_>]) -> bool {
    let distinct_sources = articles
        .iter()
        .map(SnapshotArticle::distinct_source_value)
        .collect::<HashSet<_>>();
    articles.len() >= MIN_CLUSTER_ARTICLES && distinct_sources.len() >= MIN_CLUSTER_SOURCES
}

fn metadata_counts(
    lens: BlindspotLensId,
    articles: &[SnapshotArticle<'_>],
) -> BlindspotCoverageCountsResponse {
    let mut counts = BlindspotCoverageCountsResponse {
        pole_a: 0,
        shared: 0,
        pole_b: 0,
    };
    let mut seen_sources = HashSet::new();
    for article in articles {
        if !seen_sources.insert(article.unique_source_key()) {
            continue;
        }
        let bucket = match lens {
            BlindspotLensId::Bias => bias_bucket(article.bias()),
            BlindspotLensId::Credibility => credibility_bucket(article.credibility()),
            BlindspotLensId::Geography => geography_bucket(article.country_code()),
            BlindspotLensId::InstitutionalPopulist => None,
        };
        match bucket {
            Some(BlindspotLaneId::PoleA) => counts.pole_a += 1,
            Some(BlindspotLaneId::Shared) => counts.shared += 1,
            Some(BlindspotLaneId::PoleB) => counts.pole_b += 1,
            None => {}
        }
    }
    counts
}

fn bias_bucket(value: Option<&str>) -> Option<BlindspotLaneId> {
    match value.unwrap_or_default().trim().to_lowercase().as_str() {
        "left" | "left-center" | "center-left" => Some(BlindspotLaneId::PoleA),
        "center" => Some(BlindspotLaneId::Shared),
        "right" | "right-center" | "center-right" | "libertarian" => Some(BlindspotLaneId::PoleB),
        _ => None,
    }
}

fn credibility_bucket(value: Option<&str>) -> Option<BlindspotLaneId> {
    match value.unwrap_or_default().trim().to_lowercase().as_str() {
        "very-high" | "high" => Some(BlindspotLaneId::PoleA),
        "" | "unknown" | "mixed" | "mostly-factual" | "mostly factual" | "medium" => {
            Some(BlindspotLaneId::Shared)
        }
        "low" | "very-low" => Some(BlindspotLaneId::PoleB),
        _ => None,
    }
}

fn geography_bucket(value: Option<&str>) -> Option<BlindspotLaneId> {
    let country = value?.trim().to_uppercase();
    if country.is_empty() {
        return None;
    }
    if GLOBAL_NORTH_COUNTRY_CODES.contains(&country.as_str()) {
        Some(BlindspotLaneId::PoleA)
    } else {
        Some(BlindspotLaneId::PoleB)
    }
}

fn coverage_shares(counts: &BlindspotCoverageCountsResponse) -> BlindspotCoverageSharesResponse {
    let total = counts.total();
    if total == 0 {
        return BlindspotCoverageSharesResponse {
            pole_a: 0.0,
            shared: 0.0,
            pole_b: 0.0,
        };
    }
    let total = total as f64;
    BlindspotCoverageSharesResponse {
        pole_a: round_four(counts.pole_a as f64 / total),
        shared: round_four(counts.shared as f64 / total),
        pole_b: round_four(counts.pole_b as f64 / total),
    }
}

fn classify_lane(counts: &BlindspotCoverageCountsResponse) -> BlindspotLaneId {
    let total = counts.total();
    if total == 0 {
        return BlindspotLaneId::Shared;
    }
    let shares = coverage_shares(counts);
    let pole_a_gap = shares.pole_b - shares.pole_a;
    let pole_b_gap = shares.pole_a - shares.pole_b;
    if counts.pole_b >= 2 && counts.pole_a <= 1 && pole_a_gap >= BLINDSPOT_SHARE_GAP {
        return BlindspotLaneId::PoleA;
    }
    if counts.pole_a >= 2 && counts.pole_b <= 1 && pole_b_gap >= BLINDSPOT_SHARE_GAP {
        return BlindspotLaneId::PoleB;
    }
    BlindspotLaneId::Shared
}

fn lane_score(lane: BlindspotLaneId, counts: &BlindspotCoverageCountsResponse) -> f64 {
    let shares = coverage_shares(counts);
    let total = counts.total() as f64;
    match lane {
        BlindspotLaneId::PoleA => round_four((shares.pole_b - shares.pole_a) * total),
        BlindspotLaneId::PoleB => round_four((shares.pole_a - shares.pole_b) * total),
        BlindspotLaneId::Shared => round_four(shares.pole_a.min(shares.pole_b) * total),
    }
}

fn balance_score(counts: &BlindspotCoverageCountsResponse) -> f64 {
    let shares = coverage_shares(counts);
    round_four(shares.pole_a.min(shares.pole_b))
}

fn build_card(
    cluster: &SnapshotCluster<'_>,
    articles: &[SnapshotArticle<'_>],
    selected_previews: &[BlindspotPreviewArticleResponse],
    counts: &BlindspotCoverageCountsResponse,
    lane: BlindspotLaneId,
    definition: LensDefinition,
    geography_articles: &[SnapshotArticle<'_>],
) -> BlindspotCardResponse {
    let representative_article = selected_previews
        .iter()
        .find(|article| {
            article
                .image_url
                .as_deref()
                .is_some_and(|image| !image.is_empty())
        })
        .or_else(|| selected_previews.first())
        .cloned();
    BlindspotCardResponse {
        cluster_id: cluster.cluster_id,
        cluster_label: cluster
            .label
            .filter(|label| !label.is_empty())
            .unwrap_or("Topic")
            .to_owned(),
        keywords: cluster.keywords.clone(),
        article_count: articles.len(),
        source_count: counts.total(),
        lane,
        blindspot_score: lane_score(lane, counts),
        balance_score: balance_score(counts),
        published_at: latest_published_at(articles),
        explanation: explanation_for_lane(definition, lane, counts),
        coverage_counts: counts.clone(),
        coverage_shares: coverage_shares(counts),
        representative_article,
        articles: selected_previews.to_vec(),
        geography_signals: if definition.id == BlindspotLensId::Geography {
            geography_signals(geography_articles)
        } else {
            Vec::new()
        },
        paywall_concentration: paywall_concentration(articles),
    }
}

fn select_preview_articles(
    snapshot_articles: &[SnapshotArticle<'_>],
    previews: &[BlindspotPreviewArticleResponse],
) -> Vec<BlindspotPreviewArticleResponse> {
    let mut selected = Vec::new();
    let mut seen_sources = HashSet::new();
    for (snapshot, preview) in snapshot_articles.iter().zip(previews) {
        if seen_sources.insert(snapshot.preview_source_key()) {
            selected.push(preview.clone());
            if selected.len() >= MAX_CARD_ARTICLES {
                return selected;
            }
        }
    }
    for preview in previews {
        if selected.iter().any(|selected| selected.id == preview.id) {
            continue;
        }
        selected.push(preview.clone());
        if selected.len() >= MAX_CARD_ARTICLES {
            break;
        }
    }
    selected
}

fn latest_published_at(articles: &[SnapshotArticle<'_>]) -> Option<String> {
    articles
        .iter()
        .filter_map(SnapshotArticle::published_at)
        .max()
}

fn explanation_for_lane(
    definition: LensDefinition,
    lane: BlindspotLaneId,
    counts: &BlindspotCoverageCountsResponse,
) -> String {
    match lane {
        BlindspotLaneId::PoleA => format!(
            "{} {} sources covered this story versus {} {} sources.",
            counts.pole_b, definition.pole_b_name, counts.pole_a, definition.pole_a_name
        ),
        BlindspotLaneId::PoleB => format!(
            "{} {} sources covered this story versus {} {} sources.",
            counts.pole_a, definition.pole_a_name, counts.pole_b, definition.pole_b_name
        ),
        BlindspotLaneId::Shared => format!(
            "{} {}, {} shared, and {} {} sources covered this story.",
            counts.pole_a,
            definition.pole_a_name,
            counts.shared,
            counts.pole_b,
            definition.pole_b_name
        ),
    }
}

fn lane_payloads(
    definition: LensDefinition,
    cards: &[BlindspotCardResponse],
) -> Vec<BlindspotLaneResponse> {
    BlindspotLaneId::ALL
        .into_iter()
        .map(|id| {
            let (label, description) = match id {
                BlindspotLaneId::PoleA => (
                    definition.pole_a_lane_label,
                    definition.pole_a_lane_description,
                ),
                BlindspotLaneId::Shared => (
                    definition.shared_lane_label,
                    definition.shared_lane_description,
                ),
                BlindspotLaneId::PoleB => (
                    definition.pole_b_lane_label,
                    definition.pole_b_lane_description,
                ),
            };
            BlindspotLaneResponse {
                id,
                label: label.to_owned(),
                description: description.to_owned(),
                cluster_count: cards.iter().filter(|card| card.lane == id).count(),
            }
        })
        .collect()
}

fn geography_signals(articles: &[SnapshotArticle<'_>]) -> Vec<BlindspotGeographySignalResponse> {
    let mut counts = HashMap::<&'static str, (&'static str, usize)>::new();
    for article in articles {
        if let Some((id, label)) = article.geography_signal() {
            let entry = counts.entry(id).or_insert((label, 0));
            entry.1 += 1;
        }
    }
    ["source_country", "baseline_country", "country"]
        .into_iter()
        .filter_map(|id| {
            counts
                .get(id)
                .map(|(label, count)| BlindspotGeographySignalResponse {
                    id: id.to_owned(),
                    label: (*label).to_owned(),
                    count: *count,
                })
        })
        .collect()
}

fn paywall_concentration(articles: &[SnapshotArticle<'_>]) -> PaywallConcentrationResponse {
    let mut paywalled = 0;
    let mut free = 0;
    let mut unknown = 0;
    let mut best_free_sources = Vec::new();
    let mut seen_free_sources = HashSet::new();
    for article in articles {
        match article.paywall_status().trim().to_lowercase().as_str() {
            "hard_paywall" | "paywalled" | "metered" | "subscription_required" => paywalled += 1,
            "free" | "open" | "available" => {
                free += 1;
                let source_name = article.source_name();
                let source_key = source_name.trim().to_lowercase();
                if !source_key.is_empty() && seen_free_sources.insert(source_key) {
                    best_free_sources.push(source_name.to_owned());
                }
            }
            _ => unknown += 1,
        }
    }
    let total = paywalled + free + unknown;
    let paywall_share = if total == 0 {
        0.0
    } else {
        round_four(paywalled as f64 / total as f64)
    };
    let status = if total == 0 {
        "unknown"
    } else if paywall_share >= 0.6 {
        "high"
    } else if paywall_share >= 0.3 {
        "mixed"
    } else {
        "low"
    };
    best_free_sources.truncate(4);
    PaywallConcentrationResponse {
        total_articles: total,
        paywalled_articles: paywalled,
        free_articles: free,
        unknown_articles: unknown,
        paywall_share,
        status: status.to_owned(),
        best_free_sources,
    }
}

fn compare_candidates(left: &CardCandidate, right: &CardCandidate) -> Ordering {
    right
        .lane_score
        .total_cmp(&left.lane_score)
        .then_with(|| right.card.article_count.cmp(&left.card.article_count))
        .then_with(|| right.card.published_at.cmp(&left.card.published_at))
}

fn snapshot_container_value<'a>(
    payload: &'a Value,
    containers: &[&str],
    keys: &[&str],
) -> Option<&'a str> {
    containers
        .iter()
        .filter_map(|container| payload.get(*container).and_then(Value::as_object))
        .flat_map(|container| keys.iter().filter_map(|key| container.get(*key)))
        .find_map(Value::as_str)
        .filter(|value| has_text(value))
}

fn has_text(value: &str) -> bool {
    !value.trim().is_empty()
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

fn format_timestamp(value: NaiveDateTime) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
}

fn round_four(value: f64) -> f64 {
    (value * 10_000.0).round_ties_even() / 10_000.0
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use chrono::NaiveDateTime;
    use serde_json::json;
    use thesis_db::TopicClusterSnapshotRecord;

    use super::{
        build_viewer_payload, parse_snapshot_clusters, BlindspotLaneId, BlindspotLensId,
        SEMAXIS_UNAVAILABLE_REASON,
    };

    fn snapshot() -> TopicClusterSnapshotRecord {
        TopicClusterSnapshotRecord {
            window: "1w".to_owned(),
            clusters_json: json!([{
                "cluster_id": 41,
                "label": "Water access",
                "keywords": ["water", "access"],
                "articles": [
                    {"id": 1, "title": "Story one", "source": "Source One", "source_id": "source-one", "url": "https://one.test", "published_at": "2026-09-25T10:00:00", "category": "World", "bias": "left", "country": "US", "paywall_status": "free", "similarity": 0.9, "authors": ["Reporter One"]},
                    {"id": 2, "title": "Story two", "source": "Source Two", "source_id": "source-two", "url": "https://two.test", "published_at": "2026-09-25T11:00:00", "category": "World", "bias": "right", "country": "BR", "paywall_status": "paywalled", "similarity": 0.8, "authors": []},
                    {"id": 3, "title": "Story three", "source": "Source Three", "source_id": "source-three", "url": "https://three.test", "published_at": "2026-09-25T12:00:00", "category": "World", "bias": "right", "country": "BR", "paywall_status": "paywalled", "similarity": 0.7, "authors": []},
                    {"id": 4, "title": "Story four", "source": "Source Four", "source_id": "source-four", "url": "https://four.test", "published_at": "2026-09-25T13:00:00", "category": "World", "bias": "right", "country": "BR", "paywall_status": "unknown", "similarity": 0.6, "authors": []}
                ]
            }]),
            cluster_count: 1,
            computed_at: NaiveDateTime::parse_from_str("2026-09-25 14:00:00", "%Y-%m-%d %H:%M:%S")
                .expect("fixed snapshot time"),
        }
    }

    #[test]
    fn persisted_bias_snapshot_builds_lane_and_card_from_distinct_sources() {
        let snapshot = snapshot();
        let clusters = parse_snapshot_clusters(&snapshot.clusters_json).expect("snapshot clusters");
        let articles = [];
        let response = build_viewer_payload(
            BlindspotLensId::Bias,
            None,
            &BTreeSet::new(),
            10,
            &snapshot,
            &clusters,
            &articles,
        )
        .expect("viewer response");

        assert_eq!(response.summary.total_clusters, 1);
        assert_eq!(response.summary.eligible_clusters, 1);
        assert_eq!(response.cards.len(), 1);
        assert_eq!(response.cards[0].lane, BlindspotLaneId::PoleA);
        assert_eq!(response.cards[0].coverage_counts.pole_a, 1);
        assert_eq!(response.cards[0].coverage_counts.pole_b, 3);
        assert_eq!(response.cards[0].article_count, 4);
        assert_eq!(
            response.cards[0].paywall_concentration.paywalled_articles,
            2
        );
        assert_eq!(response.cards[0].paywall_concentration.free_articles, 1);
        assert_eq!(
            response.cards[0].published_at.as_deref(),
            Some("2026-09-25T13:00:00")
        );
        assert!(!response.available_lenses[3].available);
        assert_eq!(
            response.available_lenses[3].unavailable_reason.as_deref(),
            Some(SEMAXIS_UNAVAILABLE_REASON)
        );
    }

    #[test]
    fn category_and_source_filters_reduce_snapshot_eligibility() {
        let snapshot = snapshot();
        let clusters = parse_snapshot_clusters(&snapshot.clusters_json).expect("snapshot clusters");
        let response = build_viewer_payload(
            BlindspotLensId::Bias,
            Some("WORLD".to_owned()),
            &BTreeSet::from(["source-one".to_owned(), "source-two".to_owned()]),
            10,
            &snapshot,
            &clusters,
            &[],
        )
        .expect("filtered viewer response");

        assert_eq!(response.summary.total_clusters, 1);
        assert_eq!(response.summary.eligible_clusters, 0);
        assert!(response.cards.is_empty());
        assert_eq!(
            response.summary.source_filters,
            vec!["source-one".to_owned(), "source-two".to_owned()]
        );
    }
}
#[cfg(test)]
mod b13_analysis_tests {
    use std::sync::{Arc, Mutex};

    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request, StatusCode};
    use axum::Router;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::{
        analysis_router, live_clusters_from_candidates, topic_members_from_query,
        BlindspotAnalysisError, BlindspotAnalysisFuture, BlindspotAnalysisProvider,
        BlindspotAnalysisState, CoverageReportResponse, SourceBlindSpotsResponse,
        TopicBlindSpotResponse, TOPIC_RESULT_LIMIT,
    };

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum ProviderCall {
        Source(String, i64),
        Topics(i64),
        Report(i64),
        Update,
    }

    #[derive(Clone)]
    struct FixtureProvider {
        calls: Arc<Mutex<Vec<ProviderCall>>>,
        source: SourceBlindSpotsResponse,
        topics: Vec<TopicBlindSpotResponse>,
        report: CoverageReportResponse,
        updated_sources: i64,
        error: Option<BlindspotAnalysisError>,
    }

    impl BlindspotAnalysisProvider for FixtureProvider {
        fn analyze_source_coverage(
            &self,
            source_name: String,
            days: i64,
        ) -> BlindspotAnalysisFuture<SourceBlindSpotsResponse> {
            let calls = self.calls.clone();
            let mut source = self.source.clone();
            let error = self.error.clone();
            Box::pin(async move {
                calls
                    .lock()
                    .expect("provider call lock")
                    .push(ProviderCall::Source(source_name.clone(), days));
                if let Some(error) = error {
                    return Err(error);
                }
                source.source = source_name;
                Ok(source)
            })
        }

        fn identify_topic_blind_spots(
            &self,
            min_sources: i64,
        ) -> BlindspotAnalysisFuture<Vec<TopicBlindSpotResponse>> {
            let calls = self.calls.clone();
            let topics = self.topics.clone();
            let error = self.error.clone();
            Box::pin(async move {
                calls
                    .lock()
                    .expect("provider call lock")
                    .push(ProviderCall::Topics(min_sources));
                error.map_or(Ok(topics), Err)
            })
        }

        fn generate_source_coverage_report(
            &self,
            days: i64,
        ) -> BlindspotAnalysisFuture<CoverageReportResponse> {
            let calls = self.calls.clone();
            let mut report = self.report.clone();
            report.report_period_days = days;
            let error = self.error.clone();
            Box::pin(async move {
                calls
                    .lock()
                    .expect("provider call lock")
                    .push(ProviderCall::Report(days));
                error.map_or(Ok(report), Err)
            })
        }

        fn update_daily_coverage_stats(&self) -> BlindspotAnalysisFuture<i64> {
            let calls = self.calls.clone();
            let updated_sources = self.updated_sources;
            let error = self.error.clone();
            Box::pin(async move {
                calls
                    .lock()
                    .expect("provider call lock")
                    .push(ProviderCall::Update);
                error.map_or(Ok(updated_sources), Err)
            })
        }
    }

    fn topic(cluster_id: i64, severity: &str) -> TopicBlindSpotResponse {
        TopicBlindSpotResponse {
            cluster_id,
            cluster_label: format!("Topic {cluster_id}"),
            keywords: vec!["coverage".to_owned()],
            article_count: 8,
            covering_sources: vec!["Source A".to_owned()],
            covering_count: 1,
            blind_spot_sources: vec!["Source B".to_owned()],
            blind_spot_count: 1,
            severity: severity.to_owned(),
            date_identified: "2026-09-25T12:00:00+00:00".to_owned(),
        }
    }

    fn fixture_provider(error: Option<BlindspotAnalysisError>) -> FixtureProvider {
        FixtureProvider {
            calls: Arc::new(Mutex::new(Vec::new())),
            source: SourceBlindSpotsResponse {
                source: String::new(),
                article_count: 12,
                topics_covered: 2,
                total_active_topics: 4,
                coverage_ratio: 0.5,
                blind_spots: vec![
                    json!({"severity": "high", "cluster_id": 1}),
                    json!({"severity": "low", "cluster_id": 2}),
                    json!({"severity": "medium", "cluster_id": 3}),
                ],
                coverage_gaps: vec![json!({
                    "start": "2026-09-20T00:00:00+00:00",
                    "end": "2026-09-21T12:00:00+00:00",
                    "duration_hours": 36.0
                })],
            },
            topics: vec![topic(1, "low"), topic(2, "high"), topic(3, "medium")],
            report: CoverageReportResponse {
                report_period_days: 30,
                generated_at: "2026-09-25T12:00:00+00:00".to_owned(),
                total_sources: 3,
                average_coverage_ratio: 0.536,
                average_articles_per_source: 5.0,
                source_rankings: vec![
                    json!({"source": "Fair", "coverage_ratio": 0.4}),
                    json!({"source": "Excellent", "coverage_ratio": 0.9}),
                    json!({"source": "Poor", "coverage_ratio": 0.308}),
                ],
                systemic_blind_spots: vec![json!({"cluster_id": 2})],
                underperforming_sources: vec![
                    json!({"source": "Poor", "coverage_ratio": 0.308, "blind_spots": []}),
                    json!({"source": "Fair", "coverage_ratio": 0.4, "blind_spots": []}),
                ],
            },
            updated_sources: 2,
            error,
        }
    }

    fn app(state: BlindspotAnalysisState) -> Router {
        analysis_router(state).with_state(crate::AppState::for_test())
    }

    async fn call(app: &Router, method: Method, uri: &str) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("blindspot request"),
            )
            .await
            .expect("blindspot response");
        let status = response.status();
        let body = to_bytes(response.into_body(), 32_768)
            .await
            .expect("blindspot response body");
        (
            status,
            serde_json::from_slice(&body).expect("blindspot response JSON"),
        )
    }

    #[tokio::test]
    async fn source_topics_and_report_keep_python_filters_fields_and_order() {
        let fixture = fixture_provider(None);
        let router = app(BlindspotAnalysisState::with_provider(fixture.clone()));

        let (status, source) = call(
            &router,
            Method::GET,
            "/blindspots/source/Example%20News?days=7",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(source["source"], "Example News");
        assert_eq!(source["article_count"], 12);
        assert_eq!(source["topics_covered"], 2);
        assert_eq!(source["total_active_topics"], 4);
        assert_eq!(source["coverage_ratio"], 0.5);
        assert_eq!(
            source["blind_spots"]
                .as_array()
                .expect("blind spot list")
                .iter()
                .map(|item| item["severity"].as_str().expect("severity"))
                .collect::<Vec<_>>(),
            ["medium", "low", "high"]
        );
        assert_eq!(source["coverage_gaps"][0]["duration_hours"], 36.0);

        let (status, topics) = call(&router, Method::GET, "/blindspots/topics?min_sources=6").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            topics
                .as_array()
                .expect("topic results")
                .iter()
                .map(|item| item["severity"].as_str().expect("severity"))
                .collect::<Vec<_>>(),
            ["high", "medium", "low"]
        );
        assert_eq!(topics[0]["cluster_id"], 2);
        assert_eq!(topics[0]["cluster_label"], "Topic 2");
        assert_eq!(topics[0]["covering_count"], 1);
        assert_eq!(topics[0]["blind_spot_count"], 1);
        assert_eq!(topics[0]["date_identified"], "2026-09-25T12:00:00+00:00");

        let (status, report) = call(&router, Method::GET, "/blindspots/report?days=14").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(report["report_period_days"], 14);
        assert_eq!(report["total_sources"], 3);
        assert_eq!(report["average_coverage_ratio"], 0.536);
        assert_eq!(report["source_rankings"][0]["source"], "Excellent");
        assert_eq!(report["source_rankings"][1]["source"], "Fair");
        assert_eq!(report["source_rankings"][2]["source"], "Poor");
        assert_eq!(report["systemic_blind_spots"][0]["cluster_id"], 2);

        assert_eq!(
            fixture.calls.lock().expect("provider call lock").as_slice(),
            &[
                ProviderCall::Source("Example News".to_owned(), 7),
                ProviderCall::Topics(6),
                ProviderCall::Report(14),
            ]
        );
    }

    #[tokio::test]
    async fn dashboard_and_update_stats_project_aggregates_and_fields() {
        let fixture = fixture_provider(None);
        let router = app(BlindspotAnalysisState::with_provider(fixture.clone()));

        let (status, dashboard) = call(&router, Method::GET, "/blindspots/dashboard").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(dashboard["summary"]["total_sources"], 3);
        assert_eq!(dashboard["summary"]["average_coverage"], 53.6);
        assert_eq!(dashboard["summary"]["high_severity_blind_spots"], 1);
        assert_eq!(dashboard["summary"]["medium_severity_blind_spots"], 1);
        assert_eq!(dashboard["summary"]["underperforming_sources"], 2);
        assert_eq!(
            dashboard["coverage_distribution"],
            json!({"excellent": 1, "good": 0, "fair": 1, "poor": 1})
        );
        assert_eq!(dashboard["top_blind_spots"][0]["cluster_id"], 2);
        assert_eq!(dashboard["underperforming_sources"][0]["source"], "Fair");
        assert!(dashboard["last_updated"]
            .as_str()
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok()));

        let (status, updated) = call(&router, Method::POST, "/blindspots/update-stats").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["success"], true);
        assert_eq!(updated["sources_updated"], 2);
        assert!(updated["timestamp"]
            .as_str()
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok()));
        assert_eq!(
            fixture.calls.lock().expect("provider call lock").as_slice(),
            &[
                ProviderCall::Report(7),
                ProviderCall::Topics(4),
                ProviderCall::Update,
            ]
        );
    }

    #[tokio::test]
    async fn provider_unavailable_and_failures_never_become_empty_success() {
        let unavailable_state = BlindspotAnalysisState::unavailable();
        assert!(!unavailable_state.is_configured());
        let router = app(unavailable_state);
        for (method, uri) in [
            (Method::GET, "/blindspots/source/Reuters"),
            (Method::GET, "/blindspots/topics"),
            (Method::GET, "/blindspots/report"),
            (Method::GET, "/blindspots/dashboard"),
            (Method::POST, "/blindspots/update-stats"),
        ] {
            let (status, body) = call(&router, method, uri).await;
            assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                body,
                json!({"detail": "Blindspot analysis provider is not available"})
            );
        }

        let unavailable_state = BlindspotAnalysisState::with_provider(fixture_provider(Some(
            BlindspotAnalysisError::Unavailable,
        )));
        assert!(unavailable_state.is_configured());
        let router = app(unavailable_state);
        let (status, body) = call(&router, Method::GET, "/blindspots/report").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            body,
            json!({"detail": "Blindspot analysis provider is not available"})
        );

        let router = app(BlindspotAnalysisState::with_provider(fixture_provider(
            Some(BlindspotAnalysisError::Failed(
                "SQL query failed".to_owned(),
            )),
        )));
        let (status, body) = call(&router, Method::GET, "/blindspots/report").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["detail"],
            "Failed to generate coverage report: SQL query failed"
        );

        let mut empty_fixture = fixture_provider(None);
        empty_fixture.source.article_count = 0;
        let router = app(BlindspotAnalysisState::with_provider(empty_fixture));
        let (status, body) = call(&router, Method::GET, "/blindspots/source/Reuters").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["detail"],
            "Failed to analyze source coverage: provider returned invalid result"
        );
    }

    #[tokio::test]
    async fn query_bounds_are_checked_before_live_provider_access() {
        let fixture = fixture_provider(None);
        let router = app(BlindspotAnalysisState::with_provider(fixture.clone()));
        for (uri, field) in [
            ("/blindspots/source/Reuters?days=0", "days"),
            ("/blindspots/topics?min_sources=21", "min_sources"),
            ("/blindspots/report?days=6", "days"),
        ] {
            let (status, body) = call(&router, Method::GET, uri).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(body["detail"][0]["loc"], json!(["query", field]));
        }
        assert!(fixture.calls.lock().expect("provider call lock").is_empty());
    }
    #[test]
    fn live_chroma_neighbors_apply_similarity_boundary_and_merge_components() {
        use std::collections::BTreeMap;

        let members = topic_members_from_query(
            1,
            vec![
                "article_1".to_owned(),
                "article_2".to_owned(),
                "article_3".to_owned(),
                "not-an-article".to_owned(),
                "article_4".to_owned(),
            ],
            vec![0.0, 0.18, 0.181, 0.0, f64::NAN],
        );
        assert_eq!(members.keys().copied().collect::<Vec<_>>(), [1, 2]);

        let candidates = BTreeMap::from([
            (
                1,
                BTreeMap::from([(1, 1.0), (2, 0.9), (3, 0.9), (4, 0.9), (5, 0.9)]),
            ),
            (
                5,
                BTreeMap::from([(5, 1.0), (6, 0.9), (7, 0.9), (8, 0.9), (9, 0.9)]),
            ),
            (
                10,
                BTreeMap::from([(10, 1.0), (11, 0.9), (12, 0.9), (13, 0.9)]),
            ),
        ]);
        let clusters = live_clusters_from_candidates(candidates, TOPIC_RESULT_LIMIT);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].cluster_id, 1);
        assert_eq!(clusters[0].member_ids, (1..=9).collect::<Vec<_>>());
    }
}
