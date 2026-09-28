use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt::Display;
use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use thesis_api::chroma::{
    ChromaClient, ChromaCollection, ChromaError, ChromaGetRequest, ChromaInclude,
    ChromaQueryRequest,
};
use thesis_api::discovery::{
    similarity, trending, ClusterSnapshotCache, DiscoveryError, DiscoveryFuture, DiscoveryProvider,
    DiscoveryState,
};
use thesis_api::embedding::{EmbeddingClient, EmbeddingError};
use thesis_db::{
    sha256_hex, Database, DiscoveryArticleRecord, StoryLineageArticleEdgeWrite,
    StoryLineageArticleRef, StoryLineageClaimEdgeWrite, StoryLineageClaimKey,
    StoryLineageClaimWrite, StoryLineageWrite,
};
use thesis_search::topics::{
    cluster_articles_lexical, extract_keywords_from_titles, generate_cluster_label, ArticleInput,
};

use super::ProviderClients;

const CHROMA_ARTICLE_PREFIX: &str = "article_";
const CHROMA_GET_BATCH_SIZE: usize = 1_000;
const CHROMA_QUERY_BATCH_SIZE: usize = 32;
const NEAREST_NEIGHBOR_LIMIT: usize = 50;
const SIMILARITY_THRESHOLD: f64 = 0.82;
const CLUSTER_ARTICLES_LIMIT: usize = 12;
const LEXICAL_CLUSTER_ARTICLES_LIMIT: usize = 3_000;

/// Compose the production discovery provider and its durable PostgreSQL snapshot cache.
pub(crate) fn build_discovery_state(
    database: Database,
    clients: ProviderClients,
) -> DiscoveryState {
    let snapshots = Arc::new(DatabaseClusterSnapshotCache {
        database: database.clone(),
    });
    let cluster_data = Arc::new(DatabaseClusterDataStore {
        database: database.clone(),
    });
    let provider = Arc::new(DatabaseChromaDiscoveryProvider {
        database,
        cluster_data,
        chroma: clients.chroma,
        embedding: clients.embedding,
    });
    DiscoveryState::with_adapters(Some(provider), Some(snapshots))
}

struct DatabaseClusterSnapshotCache {
    database: Database,
}

impl ClusterSnapshotCache for DatabaseClusterSnapshotCache {
    fn latest_snapshot(
        &self,
        window: String,
    ) -> DiscoveryFuture<Option<trending::ClusterSnapshot>> {
        let database = self.database.clone();
        Box::pin(async move { load_snapshot(&database, &window).await })
    }

    fn save_snapshot(
        &self,
        window: String,
        clusters: Vec<trending::AllCluster>,
    ) -> DiscoveryFuture<()> {
        let database = self.database.clone();
        Box::pin(async move {
            let value = serde_json::to_value(&clusters)
                .map_err(|error| DiscoveryError::InvalidData(error.to_string()))?;
            let Some(clusters) = value.as_array() else {
                return Err(DiscoveryError::InvalidData(
                    "serialized cluster snapshot is not an array".to_owned(),
                ));
            };
            database
                .save_topic_cluster_snapshot(&window, clusters)
                .await
                .map_err(backend_error)?;
            Ok(())
        })
    }
}

trait ClusterDataStore: Send + Sync {
    fn recent_articles(
        &self,
        since: DateTime<Utc>,
        limit: i64,
    ) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>>;
    fn articles_by_ids(&self, ids: &[i64]) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>>;
    fn gdelt_events(&self, ids: &[i64]) -> DiscoveryFuture<BTreeMap<i64, Vec<GdeltEvent>>>;
    fn snapshot_cluster(&self, cluster_id: i64) -> DiscoveryFuture<Option<trending::AllCluster>>;
    fn persist_story_lineage(
        &self,
        write: StoryLineageWrite,
    ) -> DiscoveryFuture<Option<thesis_db::PersistedStoryLineage>>;
}

struct DatabaseClusterDataStore {
    database: Database,
}

impl ClusterDataStore for DatabaseClusterDataStore {
    fn recent_articles(
        &self,
        since: DateTime<Utc>,
        limit: i64,
    ) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .load_discovery_articles_since(since, limit)
                .await
                .map_err(backend_error)
        })
    }

    fn articles_by_ids(&self, ids: &[i64]) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>> {
        let database = self.database.clone();
        let ids = ids.to_vec();
        Box::pin(async move {
            database
                .load_discovery_articles_by_ids(&ids)
                .await
                .map_err(backend_error)
        })
    }

    fn gdelt_events(&self, ids: &[i64]) -> DiscoveryFuture<BTreeMap<i64, Vec<GdeltEvent>>> {
        let database = self.database.clone();
        let ids = ids.to_vec();
        Box::pin(async move { load_gdelt_events(&database, &ids).await })
    }

    fn snapshot_cluster(&self, cluster_id: i64) -> DiscoveryFuture<Option<trending::AllCluster>> {
        let database = self.database.clone();
        Box::pin(async move { find_snapshot_cluster(&database, cluster_id).await })
    }
    fn persist_story_lineage(
        &self,
        write: StoryLineageWrite,
    ) -> DiscoveryFuture<Option<thesis_db::PersistedStoryLineage>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .persist_story_lineage(&write)
                .await
                .map_err(backend_error)
        })
    }
}

struct DatabaseChromaDiscoveryProvider {
    database: Database,
    cluster_data: Arc<dyn ClusterDataStore>,
    chroma: ChromaClient,
    embedding: EmbeddingClient,
}

impl DiscoveryProvider for DatabaseChromaDiscoveryProvider {
    fn trending_clusters(
        &self,
        window: String,
        limit: i64,
    ) -> DiscoveryFuture<Vec<trending::TrendingCluster>> {
        let cluster_data = self.cluster_data.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            if chroma.heartbeat().await.is_err() {
                return Err(DiscoveryError::VectorStoreUnavailable);
            }
            let window_start = window_start(&window)?;
            let limit = positive_usize(limit, "trending limit")?;
            let fetch_limit = limit.saturating_mul(50).min(200);
            let recent = cluster_data
                .recent_articles(window_start, fetch_limit as i64)
                .await?;
            let clusters = lexical_cluster_candidates(&recent)?;
            let member_ids = cluster_member_ids(&clusters);
            let article_rows = cluster_data.articles_by_ids(&member_ids).await?;
            let articles = article_map(article_rows);
            let events = cluster_data.gdelt_events(&member_ids).await?;
            let mut results = Vec::with_capacity(clusters.len().min(limit));

            for cluster in clusters {
                let Some(representative) = articles.get(&cluster.anchor_id) else {
                    continue;
                };
                let cluster_articles = available_cluster_articles(&cluster, &articles);
                let window_count = cluster_articles
                    .iter()
                    .filter(|article| {
                        article
                            .published_at
                            .is_some_and(|time| time >= window_start)
                    })
                    .count();
                let source_diversity = source_diversity(&cluster_articles);
                let external_count = cluster
                    .member_ids
                    .iter()
                    .filter_map(|article_id| events.get(article_id))
                    .map(Vec::len)
                    .sum::<usize>();
                let velocity = window_count as f64;
                let recency_bonus = recency_bonus(representative.published_at);
                let external_bonus = 1.0 + external_count as f64 * 0.05;
                let trending_score = round_to(
                    velocity
                        * (1.0 + source_diversity as f64 * 0.1)
                        * recency_bonus
                        * external_bonus,
                    2,
                );
                let mut result = trending::TrendingCluster {
                    cluster_id: cluster.anchor_id,
                    label: Some(cluster_label(&cluster_articles)),
                    keywords: cluster_keywords(&cluster_articles),
                    article_count: checked_i64(cluster.member_ids.len(), "cluster article count")?,
                    window_count: checked_i64(window_count, "window article count")?,
                    source_diversity: checked_i64(source_diversity, "source diversity")?,
                    trending_score,
                    velocity: round_to(velocity, 2),
                    representative_article: Some(serialize_cluster_article(representative, None)?),
                    articles: serialize_recent_cluster_articles(&cluster_articles, None)?,
                    gdelt_context: None,
                };
                attach_gdelt_context(
                    &mut result.gdelt_context,
                    &mut result.representative_article,
                    &mut result.articles,
                    &events,
                )?;
                results.push(result);
            }
            results.sort_by(|left, right| right.trending_score.total_cmp(&left.trending_score));
            results.truncate(limit);
            Ok(results)
        })
    }

    fn breaking_clusters(&self, limit: i64) -> DiscoveryFuture<Vec<trending::BreakingCluster>> {
        let cluster_data = self.cluster_data.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            if chroma.heartbeat().await.is_err() {
                return Err(DiscoveryError::VectorStoreUnavailable);
            }
            let limit = positive_usize(limit, "breaking limit")?;
            let now = Utc::now();
            let window_start = now - Duration::hours(3);
            let fetch_limit = limit.saturating_mul(50).min(100);
            let recent = cluster_data
                .recent_articles(window_start, fetch_limit as i64)
                .await?;
            let clusters = lexical_cluster_candidates(&recent)?;
            let member_ids = cluster_member_ids(&clusters);
            let article_rows = cluster_data.articles_by_ids(&member_ids).await?;
            let articles = article_map(article_rows);
            let events = cluster_data.gdelt_events(&member_ids).await?;
            let mut results = Vec::with_capacity(clusters.len().min(limit));

            for cluster in clusters {
                let Some(representative) = articles.get(&cluster.anchor_id) else {
                    continue;
                };
                let cluster_articles = available_cluster_articles(&cluster, &articles);
                let article_count_3h = cluster_articles
                    .iter()
                    .filter(|article| {
                        article
                            .published_at
                            .is_some_and(|time| time >= window_start)
                    })
                    .count();
                if article_count_3h == 0 {
                    continue;
                }
                let baseline = (cluster.member_ids.len() as f64 / 7.0).max(1.0);
                let spike_magnitude = article_count_3h as f64 / baseline;
                if spike_magnitude < 2.0 {
                    continue;
                }
                let is_new_story = representative
                    .published_at
                    .is_some_and(|published_at| (now - published_at).num_hours() < 6);
                let mut result = trending::BreakingCluster {
                    cluster_id: cluster.anchor_id,
                    label: Some(cluster_label(&cluster_articles)),
                    keywords: cluster_keywords(&cluster_articles),
                    article_count_3h: checked_i64(article_count_3h, "breaking article count")?,
                    source_count_3h: checked_i64(
                        source_diversity(&cluster_articles),
                        "breaking source count",
                    )?,
                    spike_magnitude: round_to(spike_magnitude, 2),
                    is_new_story,
                    representative_article: Some(serialize_cluster_article(representative, None)?),
                    articles: serialize_recent_cluster_articles(&cluster_articles, None)?,
                    gdelt_context: None,
                };
                attach_gdelt_context(
                    &mut result.gdelt_context,
                    &mut result.representative_article,
                    &mut result.articles,
                    &events,
                )?;
                results.push(result);
            }
            results.sort_by(|left, right| right.spike_magnitude.total_cmp(&left.spike_magnitude));
            results.truncate(limit);
            Ok(results)
        })
    }

    fn all_clusters(
        &self,
        window: String,
        min_articles: i64,
        limit: i64,
    ) -> DiscoveryFuture<Vec<trending::AllCluster>> {
        let cluster_data = self.cluster_data.clone();
        Box::pin(async move {
            let window_start = window_start(&window)?;
            let min_articles = positive_usize(min_articles, "minimum cluster size")?;
            let limit = positive_usize(limit, "cluster snapshot limit")?;
            let fetch_limit = limit.saturating_mul(50).min(50_000);
            let recent = cluster_data
                .recent_articles(window_start, fetch_limit as i64)
                .await?;
            let clusters = lexical_cluster_candidates(&recent)?;
            let member_ids = cluster_member_ids(&clusters);
            let article_rows = cluster_data.articles_by_ids(&member_ids).await?;
            let articles = article_map(article_rows);
            let events = cluster_data.gdelt_events(&member_ids).await?;
            let mut results = Vec::with_capacity(clusters.len().min(limit));

            for cluster in clusters {
                if cluster.member_ids.len() < min_articles {
                    continue;
                }
                let Some(representative) = articles.get(&cluster.anchor_id) else {
                    continue;
                };
                let cluster_articles = available_cluster_articles(&cluster, &articles);
                let mut result = trending::AllCluster {
                    cluster_id: cluster.anchor_id,
                    label: Some(cluster_label(&cluster_articles)),
                    keywords: cluster_keywords(&cluster_articles),
                    article_count: checked_i64(cluster.member_ids.len(), "cluster article count")?,
                    window_count: checked_i64(cluster.member_ids.len(), "cluster window count")?,
                    source_diversity: checked_i64(
                        source_diversity(&cluster_articles),
                        "source diversity",
                    )?,
                    representative_article: Some(serialize_cluster_article(representative, None)?),
                    articles: serialize_recent_cluster_articles(&cluster_articles, None)?,
                    gdelt_context: None,
                };
                attach_gdelt_context(
                    &mut result.gdelt_context,
                    &mut result.representative_article,
                    &mut result.articles,
                    &events,
                )?;
                results.push(result);
                if results.len() >= limit {
                    break;
                }
            }
            Ok(results)
        })
    }
    fn cluster_detail(&self, cluster_id: i64) -> DiscoveryFuture<Option<trending::ClusterDetail>> {
        let cluster_data = self.cluster_data.clone();
        Box::pin(async move {
            if let Some(snapshot) = cluster_data.snapshot_cluster(cluster_id).await? {
                return Ok(Some(snapshot_detail(cluster_id, snapshot)?));
            }

            for (window, limit) in [("1d", 500_i64), ("1w", 1_500), ("1m", 3_000)] {
                let rows = cluster_data
                    .recent_articles(window_start(window)?, limit)
                    .await?;
                let clusters = lexical_cluster_candidates(&rows)?;
                let Some(cluster) = clusters
                    .into_iter()
                    .find(|cluster| cluster.anchor_id == cluster_id)
                else {
                    continue;
                };
                let article_rows = cluster_data.articles_by_ids(&cluster.member_ids).await?;
                let articles = article_map(article_rows);
                let cluster_articles = available_cluster_articles(&cluster, &articles);
                if cluster_articles.is_empty() {
                    continue;
                }
                let mut detail = build_cluster_detail(cluster_id, &cluster, &cluster_articles)?;
                let events = cluster_data.gdelt_events(&cluster.member_ids).await?;
                attach_detail_gdelt_context(&mut detail, &events)?;
                return Ok(Some(detail));
            }
            Ok(None)
        })
    }

    fn story_lineage(
        &self,
        detail: trending::ClusterDetail,
    ) -> DiscoveryFuture<trending::StoryLineage> {
        let cluster_data = self.cluster_data.clone();
        Box::pin(async move { build_story_lineage(cluster_data.as_ref(), detail).await })
    }

    fn trending_stats(&self) -> DiscoveryFuture<trending::TrendingStats> {
        let database = self.database.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            if chroma.heartbeat().await.is_err() {
                return Err(DiscoveryError::VectorStoreUnavailable);
            }
            let total_article_assignments = database
                .count_discovery_articles_since(Utc::now() - Duration::days(1))
                .await
                .map_err(backend_error)?;
            Ok(trending::TrendingStats {
                active_clusters: 0,
                baseline_days: 0,
                breaking_window_hours: 3,
                recent_spikes: 0,
                similarity_threshold: SIMILARITY_THRESHOLD,
                total_article_assignments,
            })
        })
    }

    fn related_articles(
        &self,
        article_id: i64,
        limit: i64,
        exclude_same_source: bool,
    ) -> DiscoveryFuture<Option<similarity::RelatedSnapshot>> {
        let database = self.database.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            let source_rows = database
                .load_discovery_articles_by_ids(&[article_id])
                .await
                .map_err(backend_error)?;
            let Some(source) = source_rows.first() else {
                return Ok(None);
            };
            let limit = positive_usize(limit, "related-article limit")?;
            let collection = get_collection(&chroma).await?;
            let source_chroma_id = chroma_article_id(article_id)?;
            let embedding_response = collection
                .get(ChromaGetRequest {
                    ids: Some(vec![source_chroma_id.clone()]),
                    include: vec![ChromaInclude::Embeddings],
                    ..ChromaGetRequest::default()
                })
                .await
                .map_err(chroma_error)?;
            let source_embedding = embedding_for_id(embedding_response, article_id)?;
            let Some(source_embedding) = source_embedding else {
                return Ok(Some(similarity::RelatedSnapshot {
                    source_article_id: article_id,
                    hits: Vec::new(),
                    articles: BTreeMap::new(),
                }));
            };
            let where_filter = exclude_same_source
                .then(|| source.source_id.as_deref())
                .flatten()
                .filter(|source_id| !source_id.is_empty())
                .map(|source_id| json!({"source_id": {"$ne": source_id}}));
            let response = collection
                .query(ChromaQueryRequest {
                    query_embeddings: vec![source_embedding],
                    n_results: limit.saturating_add(1),
                    where_filter,
                    where_document: None,
                    include: vec![
                        ChromaInclude::Metadatas,
                        ChromaInclude::Documents,
                        ChromaInclude::Distances,
                    ],
                })
                .await
                .map_err(chroma_error)?;
            let hits = related_hits(article_id, limit, &response)?;
            let related_ids = hits.iter().map(|hit| hit.article_id).collect::<Vec<_>>();
            let related_rows = database
                .load_discovery_articles_by_ids(&related_ids)
                .await
                .map_err(backend_error)?;
            let articles = related_rows
                .into_iter()
                .map(|article| Ok((article.id, similarity_article(article)?)))
                .collect::<Result<BTreeMap<_, _>, DiscoveryError>>()?;
            Ok(Some(similarity::RelatedSnapshot {
                source_article_id: article_id,
                hits,
                articles,
            }))
        })
    }

    fn search_suggestions(
        &self,
        query: String,
        limit: i64,
    ) -> DiscoveryFuture<Vec<similarity::SearchSuggestion>> {
        let chroma = self.chroma.clone();
        let embedding = self.embedding.clone();
        Box::pin(async move {
            let limit = positive_usize(limit, "search-suggestion limit")?;
            let embedded = embedding
                .embed(std::slice::from_ref(&query), 1)
                .await
                .map_err(embedding_error)?;
            let query_embedding = embedded.embeddings.into_iter().next().ok_or_else(|| {
                DiscoveryError::InvalidData("embedding sidecar returned no query vector".to_owned())
            })?;
            let collection = get_collection(&chroma).await?;
            let response = collection
                .query(ChromaQueryRequest {
                    query_embeddings: vec![query_embedding],
                    n_results: limit.saturating_mul(2),
                    where_filter: None,
                    where_document: None,
                    include: vec![
                        ChromaInclude::Metadatas,
                        ChromaInclude::Documents,
                        ChromaInclude::Distances,
                    ],
                })
                .await
                .map_err(chroma_error)?;
            search_suggestion_rows(limit, response)
        })
    }

    fn source_coverage(
        &self,
        source_ids: Vec<String>,
        sample_size: i64,
    ) -> DiscoveryFuture<similarity::SourceCoveragePayload> {
        let chroma = self.chroma.clone();
        Box::pin(async move {
            let sample_size = positive_usize(sample_size, "source coverage sample size")?;
            let collection = get_collection(&chroma).await?;
            let mut source_embeddings = BTreeMap::<String, Vec<Vec<f64>>>::new();
            let mut all_embeddings = Vec::<Vec<f64>>::new();
            for source_id in source_ids {
                let response = collection
                    .get(ChromaGetRequest {
                        where_filter: Some(json!({"source_id": source_id})),
                        limit: Some(sample_size),
                        include: vec![ChromaInclude::Embeddings],
                        ..ChromaGetRequest::default()
                    })
                    .await
                    .map_err(chroma_error)?;
                let embeddings = embedding_rows(response)?;
                all_embeddings.extend(embeddings.iter().cloned());
                source_embeddings.insert(source_id, embeddings);
            }
            if all_embeddings.is_empty() {
                return Ok(BTreeMap::from([(
                    "error".to_owned(),
                    Value::String("No embeddings found for sources".to_owned()),
                )]));
            }
            let (global_centroid, global_std) = mean_and_std(&all_embeddings)?;
            let global_std_mean = mean(&global_std);
            let mut sources = BTreeMap::new();
            for (source_id, embeddings) in source_embeddings {
                if embeddings.is_empty() {
                    sources.insert(source_id, json!({"article_count": 0}));
                    continue;
                }
                let (source_centroid, source_std) = mean_and_std(&embeddings)?;
                if source_centroid.len() != global_centroid.len() {
                    return Err(DiscoveryError::InvalidData(
                        "source embeddings do not share one dimension".to_owned(),
                    ));
                }
                let centroid_distance = source_centroid
                    .iter()
                    .zip(&global_centroid)
                    .map(|(source, global)| (source - global).powi(2))
                    .sum::<f64>()
                    .sqrt();
                let spread = mean(&source_std);
                let diversity_score = spread / (global_std_mean + 1e-8);
                sources.insert(
                    source_id,
                    json!({
                        "article_count": embeddings.len(),
                        "centroid_distance": centroid_distance,
                        "spread": spread,
                        "diversity_score": diversity_score,
                    }),
                );
            }
            Ok(BTreeMap::from([
                ("sources".to_owned(), Value::Object(Map::from_iter(sources))),
                (
                    "global_article_count".to_owned(),
                    json!(all_embeddings.len()),
                ),
            ]))
        })
    }

    fn embeddings(
        &self,
        article_ids: Vec<i64>,
    ) -> DiscoveryFuture<Vec<similarity::ArticleEmbedding>> {
        let chroma = self.chroma.clone();
        Box::pin(async move {
            let collection = get_collection(&chroma).await?;
            let mut result = Vec::new();
            let article_ids = unique_ids(&article_ids);
            for ids in article_ids.chunks(CHROMA_GET_BATCH_SIZE) {
                let requested = ids
                    .iter()
                    .map(|id| chroma_article_id(*id))
                    .collect::<Result<Vec<_>, _>>()?;
                let response = collection
                    .get(ChromaGetRequest {
                        ids: Some(requested),
                        include: vec![ChromaInclude::Embeddings],
                        ..ChromaGetRequest::default()
                    })
                    .await
                    .map_err(chroma_error)?;
                result.extend(article_embeddings_from_get(ids, response)?);
            }
            Ok(result)
        })
    }

    fn article_topics(&self, article_id: i64) -> DiscoveryFuture<Vec<similarity::ArticleTopic>> {
        let database = self.database.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            let collection = get_collection(&chroma).await?;
            let candidates = query_anchor_candidates(&collection, &[article_id]).await?;
            let Some(cluster) = candidates.get(&article_id) else {
                return Ok(Vec::new());
            };
            let article_rows = database
                .load_discovery_articles_by_ids(&cluster.member_ids)
                .await
                .map_err(backend_error)?;
            let articles = article_map(article_rows);
            let articles = available_cluster_articles(cluster, &articles);
            if articles.is_empty() {
                return Ok(Vec::new());
            }
            Ok(vec![similarity::ArticleTopic {
                cluster_id: cluster.anchor_id,
                label: Some(cluster_label(&articles)),
                similarity: Some(round_to(
                    cluster
                        .similarities
                        .get(&article_id)
                        .copied()
                        .unwrap_or(1.0),
                    3,
                )),
                keywords: cluster_keywords(&articles),
            }])
        })
    }

    fn bulk_article_topics(
        &self,
        article_ids: Vec<i64>,
    ) -> DiscoveryFuture<BTreeMap<i64, Vec<similarity::ArticleTopic>>> {
        let database = self.database.clone();
        let chroma = self.chroma.clone();
        Box::pin(async move {
            let article_ids = unique_ids(&article_ids);
            if article_ids.is_empty() {
                return Ok(BTreeMap::new());
            }
            let collection = get_collection(&chroma).await?;
            let candidates = query_anchor_candidates(&collection, &article_ids).await?;
            let mut all_member_ids = BTreeSet::new();
            for cluster in candidates.values() {
                all_member_ids.extend(cluster.member_ids.iter().copied());
            }
            let article_rows = database
                .load_discovery_articles_by_ids(&all_member_ids.into_iter().collect::<Vec<_>>())
                .await
                .map_err(backend_error)?;
            let articles = article_map(article_rows);
            let mut result = BTreeMap::new();
            for article_id in article_ids {
                let topics = candidates
                    .get(&article_id)
                    .and_then(|cluster| {
                        let cluster_articles = available_cluster_articles(cluster, &articles);
                        (!cluster_articles.is_empty()).then(|| {
                            vec![similarity::ArticleTopic {
                                cluster_id: cluster.anchor_id,
                                label: Some(cluster_label(&cluster_articles)),
                                similarity: Some(round_to(
                                    cluster
                                        .similarities
                                        .get(&article_id)
                                        .copied()
                                        .unwrap_or(1.0),
                                    3,
                                )),
                                keywords: cluster_keywords(&cluster_articles),
                            }]
                        })
                    })
                    .unwrap_or_default();
                result.insert(article_id, topics);
            }
            Ok(result)
        })
    }
}

async fn load_snapshot(
    database: &Database,
    window: &str,
) -> Result<Option<trending::ClusterSnapshot>, DiscoveryError> {
    let Some(snapshot) = database
        .load_latest_topic_snapshot(window)
        .await
        .map_err(backend_error)?
    else {
        return Ok(None);
    };
    let stored =
        serde_json::from_value::<Vec<StoredCluster>>(snapshot.clusters_json).map_err(|error| {
            DiscoveryError::InvalidData(format!("invalid {window} cluster snapshot: {error}"))
        })?;
    Ok(Some(trending::ClusterSnapshot {
        clusters: stored.into_iter().map(Into::into).collect(),
        computed_at: Some(
            snapshot
                .computed_at
                .format("%Y-%m-%dT%H:%M:%S%.f")
                .to_string(),
        ),
    }))
}

async fn find_snapshot_cluster(
    database: &Database,
    cluster_id: i64,
) -> Result<Option<trending::AllCluster>, DiscoveryError> {
    let mut best = None;
    for window in ["1w", "1d", "1m"] {
        let Some(snapshot) = load_snapshot(database, window).await? else {
            continue;
        };
        for cluster in snapshot.clusters {
            if cluster.cluster_id != cluster_id {
                continue;
            }
            let replace = best.as_ref().is_none_or(|current: &trending::AllCluster| {
                cluster.article_count > current.article_count
            });
            if replace {
                best = Some(cluster);
            }
        }
    }
    Ok(best)
}

#[derive(Deserialize)]
struct StoredCluster {
    cluster_id: i64,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
    article_count: i64,
    #[serde(default)]
    window_count: i64,
    #[serde(default)]
    source_diversity: i64,
    #[serde(default)]
    representative_article: Option<StoredClusterArticle>,
    #[serde(default)]
    articles: Vec<StoredClusterArticle>,
    #[serde(default)]
    gdelt_context: Option<StoredGdeltContext>,
}

#[derive(Deserialize)]
struct StoredClusterArticle {
    id: i64,
    title: String,
    source: String,
    #[serde(default)]
    source_id: Option<String>,
    url: String,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    similarity: Option<f64>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    gdelt_context: Option<StoredGdeltContext>,
}

#[derive(Deserialize)]
struct StoredGdeltContext {
    total_events: i64,
    #[serde(default)]
    top_cameo: Vec<StoredTopCameo>,
    #[serde(default)]
    goldstein_avg: Option<f64>,
    #[serde(default)]
    goldstein_min: Option<f64>,
    #[serde(default)]
    goldstein_max: Option<f64>,
    #[serde(default)]
    goldstein_bucket: Option<String>,
    #[serde(default)]
    tone_avg: Option<f64>,
    #[serde(default)]
    tone_baseline_avg: Option<f64>,
    #[serde(default)]
    tone_delta_vs_cluster: Option<f64>,
}

#[derive(Deserialize)]
struct StoredTopCameo {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    label: Option<String>,
    count: i64,
}

impl From<StoredCluster> for trending::AllCluster {
    fn from(cluster: StoredCluster) -> Self {
        Self {
            cluster_id: cluster.cluster_id,
            label: cluster.label,
            keywords: cluster.keywords,
            article_count: cluster.article_count,
            window_count: cluster.window_count,
            source_diversity: cluster.source_diversity,
            representative_article: cluster.representative_article.map(Into::into),
            articles: cluster.articles.into_iter().map(Into::into).collect(),
            gdelt_context: cluster.gdelt_context.map(Into::into),
        }
    }
}

impl From<StoredClusterArticle> for trending::ClusterArticle {
    fn from(article: StoredClusterArticle) -> Self {
        Self {
            id: article.id,
            title: article.title,
            source: article.source,
            source_id: article.source_id,
            url: article.url,
            image_url: article.image_url,
            published_at: article.published_at,
            summary: article.summary,
            similarity: article.similarity,
            author: article.author,
            authors: article.authors,
            gdelt_context: article.gdelt_context.map(Into::into),
        }
    }
}

impl From<StoredGdeltContext> for trending::GdeltContext {
    fn from(context: StoredGdeltContext) -> Self {
        Self {
            total_events: context.total_events,
            top_cameo: context.top_cameo.into_iter().map(Into::into).collect(),
            goldstein_avg: context.goldstein_avg,
            goldstein_min: context.goldstein_min,
            goldstein_max: context.goldstein_max,
            goldstein_bucket: context.goldstein_bucket,
            tone_avg: context.tone_avg,
            tone_baseline_avg: context.tone_baseline_avg,
            tone_delta_vs_cluster: context.tone_delta_vs_cluster,
        }
    }
}

impl From<StoredTopCameo> for trending::GdeltTopCameo {
    fn from(cameo: StoredTopCameo) -> Self {
        Self {
            code: cameo.code,
            label: cameo.label,
            count: cameo.count,
        }
    }
}

#[derive(Clone, Debug)]
struct CandidateCluster {
    anchor_id: i64,
    member_ids: Vec<i64>,
    similarities: BTreeMap<i64, f64>,
}
fn lexical_cluster_candidates(
    articles: &[DiscoveryArticleRecord],
) -> Result<Vec<CandidateCluster>, DiscoveryError> {
    let lexical_articles = articles
        .iter()
        .take(LEXICAL_CLUSTER_ARTICLES_LIMIT)
        .enumerate()
        .map(|(order_index, article)| {
            Ok(ArticleInput {
                article_id: article.id,
                title: article.title.clone(),
                order_index: u32::try_from(order_index).map_err(|_| {
                    DiscoveryError::InvalidData("lexical article order overflowed".to_owned())
                })?,
            })
        })
        .collect::<Result<Vec<_>, DiscoveryError>>()?;
    Ok(cluster_articles_lexical(lexical_articles)
        .into_iter()
        .map(|cluster| CandidateCluster {
            anchor_id: cluster.anchor_id,
            member_ids: cluster.member_ids,
            similarities: cluster.similarities.into_iter().collect(),
        })
        .collect())
}

async fn get_collection(chroma: &ChromaClient) -> Result<ChromaCollection, DiscoveryError> {
    chroma.get_collection().await.map_err(chroma_error)
}

async fn query_anchor_candidates(
    collection: &ChromaCollection,
    article_ids: &[i64],
) -> Result<BTreeMap<i64, CandidateCluster>, DiscoveryError> {
    let mut candidates = BTreeMap::new();
    for requested_ids in article_ids.chunks(CHROMA_GET_BATCH_SIZE) {
        if requested_ids.is_empty() {
            continue;
        }
        let requested_chroma_ids = requested_ids
            .iter()
            .map(|article_id| chroma_article_id(*article_id))
            .collect::<Result<Vec<_>, _>>()?;
        let embeddings_response = collection
            .get(ChromaGetRequest {
                ids: Some(requested_chroma_ids),
                include: vec![ChromaInclude::Embeddings],
                ..ChromaGetRequest::default()
            })
            .await
            .map_err(chroma_error)?;
        let embeddings = article_embeddings_from_get(requested_ids, embeddings_response)?;
        let mut embeddings_by_id = embeddings
            .into_iter()
            .map(|embedding| (embedding.article_id, embedding.values))
            .collect::<BTreeMap<_, _>>();
        let anchors = requested_ids
            .iter()
            .filter_map(|article_id| {
                embeddings_by_id
                    .remove(article_id)
                    .map(|embedding| (*article_id, embedding))
            })
            .collect::<Vec<_>>();

        for anchor_batch in anchors.chunks(CHROMA_QUERY_BATCH_SIZE) {
            let response = collection
                .query(ChromaQueryRequest {
                    query_embeddings: anchor_batch
                        .iter()
                        .map(|(_, embedding)| embedding.clone())
                        .collect(),
                    n_results: NEAREST_NEIGHBOR_LIMIT,
                    where_filter: None,
                    where_document: None,
                    include: vec![ChromaInclude::Distances],
                })
                .await
                .map_err(chroma_error)?;
            let distances = response.distances.as_ref().ok_or_else(|| {
                DiscoveryError::InvalidData("Chroma query omitted distances".to_owned())
            })?;
            for ((anchor_id, _), (neighbor_ids, neighbor_distances)) in
                anchor_batch.iter().zip(response.ids.iter().zip(distances))
            {
                if let Some(candidate) =
                    candidate_from_neighbors(*anchor_id, neighbor_ids, neighbor_distances)?
                {
                    candidates.insert(*anchor_id, candidate);
                }
            }
        }
    }
    Ok(candidates)
}

fn candidate_from_neighbors(
    anchor_id: i64,
    neighbor_ids: &[String],
    distances: &[f64],
) -> Result<Option<CandidateCluster>, DiscoveryError> {
    if neighbor_ids.len() != distances.len() {
        return Err(DiscoveryError::InvalidData(
            "Chroma neighbor IDs and distances are misaligned".to_owned(),
        ));
    }
    let mut similarities = BTreeMap::new();
    for (raw_id, distance) in neighbor_ids.iter().zip(distances) {
        if !distance.is_finite() {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned a non-finite distance".to_owned(),
            ));
        }
        let Some(article_id) = parse_chroma_article_id(raw_id) else {
            continue;
        };
        let similarity = 1.0 - distance;
        if similarity >= SIMILARITY_THRESHOLD {
            similarities.insert(article_id, similarity);
        }
    }
    similarities.entry(anchor_id).or_insert(1.0);
    if similarities.len() < 2 {
        return Ok(None);
    }
    Ok(Some(CandidateCluster {
        anchor_id,
        member_ids: similarities.keys().copied().collect(),
        similarities,
    }))
}

fn cluster_member_ids(clusters: &[CandidateCluster]) -> Vec<i64> {
    clusters
        .iter()
        .flat_map(|cluster| cluster.member_ids.iter().copied())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn article_map(articles: Vec<DiscoveryArticleRecord>) -> BTreeMap<i64, DiscoveryArticleRecord> {
    articles
        .into_iter()
        .map(|article| (article.id, article))
        .collect()
}

fn available_cluster_articles<'a>(
    cluster: &CandidateCluster,
    articles: &'a BTreeMap<i64, DiscoveryArticleRecord>,
) -> Vec<&'a DiscoveryArticleRecord> {
    cluster
        .member_ids
        .iter()
        .filter_map(|article_id| articles.get(article_id))
        .collect()
}

fn source_diversity(articles: &[&DiscoveryArticleRecord]) -> usize {
    articles
        .iter()
        .filter_map(|article| {
            let source = article.source.trim();
            (!source.is_empty()).then_some(source)
        })
        .collect::<BTreeSet<_>>()
        .len()
}

fn cluster_keywords(articles: &[&DiscoveryArticleRecord]) -> Vec<String> {
    extract_keywords_from_titles(
        articles
            .iter()
            .map(|article| article.title.clone())
            .collect(),
    )
}

fn cluster_label(articles: &[&DiscoveryArticleRecord]) -> String {
    let now = Utc::now();
    let candidates = articles
        .iter()
        .filter(|article| !article.title.is_empty())
        .map(|article| (article.title.clone(), title_score(article, now)))
        .collect();
    generate_cluster_label(candidates)
}

fn title_score(article: &DiscoveryArticleRecord, now: DateTime<Utc>) -> f64 {
    let title = article.title.trim();
    let length = title.chars().count();
    let length_score = if (40..=100).contains(&length) {
        10.0
    } else if (30..40).contains(&length) {
        7.0
    } else if (101..=140).contains(&length) {
        6.0
    } else if length < 30 {
        3.0
    } else {
        1.0
    };
    let credibility_score = match article.credibility.as_deref() {
        Some("high") => 5.0,
        Some("medium") => 2.0,
        _ => 0.0,
    };
    let recency_score = article.published_at.map_or(0.0, |published_at| {
        let age_hours = (now - published_at).num_minutes() as f64 / 60.0;
        if age_hours < 6.0 {
            3.0
        } else if age_hours < 24.0 {
            2.0
        } else if age_hours < 72.0 {
            1.0
        } else {
            0.0
        }
    });
    let lower = title.to_lowercase();
    let generic_penalty = ["breaking", "update", "news alert", "developing"]
        .iter()
        .filter(|term| lower.contains(**term))
        .count() as f64
        * -5.0;
    length_score + credibility_score + recency_score + generic_penalty + capitalization_score(title)
}

fn capitalization_score(title: &str) -> f64 {
    let chars = title.chars().collect::<Vec<_>>();
    let mut matches = 0_usize;
    let mut index = 0_usize;
    while index < chars.len() {
        if !is_word_boundary_before(&chars, index) || !chars[index].is_ascii_uppercase() {
            index += 1;
            continue;
        }
        let Some(mut end) = capitalized_word_end(&chars, index) else {
            index += 1;
            continue;
        };
        if !is_word_boundary_after(&chars, end) {
            index += 1;
            continue;
        }
        loop {
            let mut next = end;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            let Some(next_end) = capitalized_word_end(&chars, next) else {
                break;
            };
            if !is_word_boundary_after(&chars, next_end) {
                break;
            }
            end = next_end;
        }
        matches += 1;
        index = end;
    }
    (matches as f64 * 1.5).min(8.0)
}

fn capitalized_word_end(chars: &[char], start: usize) -> Option<usize> {
    if start >= chars.len() || !chars[start].is_ascii_uppercase() {
        return None;
    }
    let mut end = start + 1;
    while end < chars.len() && chars[end].is_ascii_alphabetic() {
        end += 1;
    }
    (end - start >= 2).then_some(end)
}

fn is_word_boundary_before(chars: &[char], index: usize) -> bool {
    index == 0 || !is_word_char(chars[index - 1])
}

fn is_word_boundary_after(chars: &[char], index: usize) -> bool {
    index == chars.len() || !is_word_char(chars[index])
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn serialize_recent_cluster_articles(
    articles: &[&DiscoveryArticleRecord],
    similarities: Option<&BTreeMap<i64, f64>>,
) -> Result<Vec<trending::ClusterArticle>, DiscoveryError> {
    let mut ordered = articles.to_vec();
    ordered.sort_by(|left, right| {
        right
            .published_at
            .cmp(&left.published_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    ordered.truncate(CLUSTER_ARTICLES_LIMIT);
    ordered
        .into_iter()
        .map(|article| {
            serialize_cluster_article(
                article,
                similarities.and_then(|values| values.get(&article.id).copied()),
            )
        })
        .collect()
}

fn serialize_cluster_article(
    article: &DiscoveryArticleRecord,
    similarity: Option<f64>,
) -> Result<trending::ClusterArticle, DiscoveryError> {
    let url = article
        .url
        .clone()
        .ok_or_else(|| DiscoveryError::InvalidData(format!("article {} has no URL", article.id)))?;
    Ok(trending::ClusterArticle {
        id: article.id,
        title: article.title.clone(),
        source: article.source.clone(),
        source_id: source_slug(&article.source),
        url,
        image_url: article.image_url.clone(),
        published_at: article
            .published_at
            .map(|published_at| published_at.to_rfc3339_opts(SecondsFormat::AutoSi, true)),
        summary: article
            .summary
            .as_deref()
            .map(|summary| truncate_chars(summary, 200)),
        similarity,
        author: article.author.clone(),
        authors: article.authors.clone(),
        gdelt_context: None,
    })
}

fn source_slug(source: &str) -> Option<String> {
    let words = source.split_whitespace().collect::<Vec<_>>();
    (!words.is_empty()).then(|| words.join("-").to_lowercase())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_owned()
    } else {
        value.chars().take(max_chars).collect()
    }
}

fn serialize_cluster_detail_article(
    article: &DiscoveryArticleRecord,
    similarity: f64,
) -> Result<trending::ClusterArticle, DiscoveryError> {
    let url = article
        .url
        .clone()
        .ok_or_else(|| DiscoveryError::InvalidData(format!("article {} has no URL", article.id)))?;
    Ok(trending::ClusterArticle {
        id: article.id,
        title: article.title.clone(),
        source: article.source.clone(),
        source_id: None,
        url,
        image_url: article.image_url.clone(),
        published_at: article
            .published_at
            .map(|published_at| published_at.to_rfc3339_opts(SecondsFormat::AutoSi, true)),
        summary: None,
        similarity: Some(similarity),
        author: None,
        authors: Vec::new(),
        gdelt_context: None,
    })
}
fn build_cluster_detail(
    cluster_id: i64,
    cluster: &CandidateCluster,
    articles: &[&DiscoveryArticleRecord],
) -> Result<trending::ClusterDetail, DiscoveryError> {
    let mut serialized_articles = Vec::with_capacity(articles.len());
    for article in articles {
        let similarity = cluster
            .similarities
            .get(&article.id)
            .copied()
            .unwrap_or(0.0);
        serialized_articles.push(serialize_cluster_detail_article(
            article,
            round_to(similarity, 3),
        )?);
    }
    let first_seen = articles
        .iter()
        .filter_map(|article| article.published_at)
        .min()
        .map(|published_at| published_at.to_rfc3339_opts(SecondsFormat::AutoSi, true));
    let last_seen = articles
        .iter()
        .filter_map(|article| article.published_at)
        .max()
        .map(|published_at| published_at.to_rfc3339_opts(SecondsFormat::AutoSi, true));
    Ok(trending::ClusterDetail {
        id: cluster_id,
        label: Some(cluster_label(articles)),
        keywords: cluster_keywords(articles),
        article_count: checked_i64(cluster.member_ids.len(), "cluster article count")?,
        first_seen,
        last_seen,
        is_active: true,
        articles: serialized_articles,
        gdelt_context: None,
    })
}

fn snapshot_detail(
    cluster_id: i64,
    mut cluster: trending::AllCluster,
) -> Result<trending::ClusterDetail, DiscoveryError> {
    for article in &mut cluster.articles {
        if article.similarity.is_none() {
            article.similarity = Some(1.0);
        }
    }
    let mut dates = cluster
        .articles
        .iter()
        .filter_map(|article| article.published_at.as_deref())
        .collect::<Vec<_>>();
    dates.sort_unstable();
    Ok(trending::ClusterDetail {
        id: cluster_id,
        label: Some(cluster.label.unwrap_or_else(|| "Topic".to_owned())),
        keywords: cluster.keywords,
        article_count: cluster.article_count,
        first_seen: dates.first().map(|date| (*date).to_owned()),
        last_seen: dates.last().map(|date| (*date).to_owned()),
        is_active: true,
        articles: cluster.articles,
        gdelt_context: cluster.gdelt_context,
    })
}
async fn build_story_lineage(
    cluster_data: &dyn ClusterDataStore,
    detail: trending::ClusterDetail,
) -> Result<trending::StoryLineage, DiscoveryError> {
    let mut articles = detail.articles;
    articles.sort_by(|left, right| {
        match (
            lineage_datetime(left.published_at.as_deref()),
            lineage_datetime(right.published_at.as_deref()),
        ) {
            (Some(left), Some(right)) => left.cmp(&right),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });
    if articles.is_empty() {
        return Ok(trending::StoryLineage {
            status: "insufficient_data".to_owned(),
            reason: Some("Cluster has no articles.".to_owned()),
            story: None,
            article_edges: Vec::new(),
            claims: Vec::new(),
            claim_edges: Vec::new(),
            corrections: Vec::new(),
        });
    }

    let article_lookup = articles
        .iter()
        .map(|article| (article.id, article))
        .collect::<BTreeMap<_, _>>();
    let article_refs = articles
        .iter()
        .map(|article| StoryLineageArticleRef {
            article_id: article.id,
            source: article.source.clone(),
        })
        .collect();
    let article_edges = build_lineage_article_edges(&articles);
    let claim_candidates = build_lineage_claim_candidates(&articles);
    let claim_edges = build_lineage_claim_edges(&claim_candidates);
    let claims = claim_candidates
        .iter()
        .map(|candidate| candidate.write.clone())
        .collect();
    let label = detail.label.clone();
    let persisted = cluster_data
        .persist_story_lineage(StoryLineageWrite {
            external_cluster_id: detail.id,
            label: Some(
                label
                    .clone()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "Topic".to_owned()),
            ),
            keywords: detail.keywords.clone(),
            first_seen_at: detail.first_seen.as_deref().and_then(lineage_datetime),
            last_seen_at: detail.last_seen.as_deref().and_then(lineage_datetime),
            articles: article_refs,
            article_edges,
            claims,
            claim_edges,
        })
        .await?
        .ok_or_else(|| {
            DiscoveryError::InvalidData(
                "lineage database returned no story for a non-empty cluster".to_owned(),
            )
        })?;
    persisted_story_lineage(persisted, &article_lookup, label)
}

#[derive(Clone)]
struct LineageClaimCandidate {
    write: StoryLineageClaimWrite,
    numbers: Vec<String>,
}

fn build_lineage_article_edges(
    articles: &[trending::ClusterArticle],
) -> Vec<StoryLineageArticleEdgeWrite> {
    let Some((origin, targets)) = articles.split_first() else {
        return Vec::new();
    };
    let mut edges = Vec::with_capacity(targets.len());
    for target in targets {
        let similarity =
            lineage_text_similarity(&lineage_article_text(origin), &lineage_article_text(target));
        let relation = if origin.source == target.source {
            ("updates", 0.55_f64.max(similarity))
        } else if is_lineage_wire_source(&origin.source) || is_lineage_wire_source(&target.source) {
            ("same_wire_story", 0.65_f64.max(similarity))
        } else if similarity >= 0.55 {
            ("likely_source", similarity)
        } else {
            ("later_variant", 0.35_f64.max(similarity))
        };
        edges.push(StoryLineageArticleEdgeWrite {
            from_article_id: origin.id,
            to_article_id: target.id,
            relation: relation.0.to_owned(),
            evidence: json!({
                "shared_text_similarity": round_to(similarity, 3),
                "origin_source": origin.source,
                "target_source": target.source,
            }),
            confidence: round_to(relation.1, 3),
        });
    }
    edges
}

fn build_lineage_claim_candidates(
    articles: &[trending::ClusterArticle],
) -> Vec<LineageClaimCandidate> {
    let mut seen = BTreeSet::new();
    let mut candidates = Vec::new();
    for article in articles {
        let text = lineage_article_text(article);
        for claim_text in lineage_claim_sentences(&text) {
            let normalized = normalize_lineage_claim(&claim_text);
            let claim_hash = sha256_hex(normalized.as_bytes())
                .chars()
                .take(24)
                .collect::<String>();
            if !seen.insert((article.id, claim_hash.clone())) {
                continue;
            }
            let numbers = lineage_numbers(&claim_text);
            candidates.push(LineageClaimCandidate {
                write: StoryLineageClaimWrite {
                    article_id: article.id,
                    claim_text: claim_text.clone(),
                    normalized_claim: normalized,
                    claim_hash,
                    claim_type: lineage_claim_type(&claim_text),
                    checkability: if numbers.is_empty() { "medium" } else { "high" }.to_owned(),
                    evidence_span: Some(claim_text),
                    entities: json!([]),
                    numbers: json!(numbers),
                },
                numbers,
            });
        }
    }
    candidates
}

fn build_lineage_claim_edges(claims: &[LineageClaimCandidate]) -> Vec<StoryLineageClaimEdgeWrite> {
    let mut edges = Vec::new();
    for (left_index, left) in claims.iter().enumerate() {
        for right in &claims[left_index + 1..] {
            if left.write.article_id == right.write.article_id {
                continue;
            }
            let similarity = lineage_text_similarity(
                &left.write.normalized_claim,
                &right.write.normalized_claim,
            );
            if similarity < 0.35 {
                continue;
            }
            let conflicting_numbers = !left.numbers.is_empty()
                && !right.numbers.is_empty()
                && left.numbers.iter().collect::<BTreeSet<_>>()
                    != right.numbers.iter().collect::<BTreeSet<_>>();
            let relation = if conflicting_numbers {
                ("contradicts", 0.65_f64.max(similarity))
            } else if similarity >= 0.72 {
                ("equivalent", similarity)
            } else {
                ("supports", similarity)
            };
            edges.push(StoryLineageClaimEdgeWrite {
                from_claim: StoryLineageClaimKey {
                    article_id: left.write.article_id,
                    claim_hash: left.write.claim_hash.clone(),
                },
                to_claim: StoryLineageClaimKey {
                    article_id: right.write.article_id,
                    claim_hash: right.write.claim_hash.clone(),
                },
                relation: relation.0.to_owned(),
                evidence: json!({
                    "left_claim": left.write.claim_text,
                    "right_claim": right.write.claim_text,
                }),
                confidence: round_to(relation.1, 3),
            });
        }
    }
    edges
}

fn persisted_story_lineage(
    persisted: thesis_db::PersistedStoryLineage,
    articles: &BTreeMap<i64, &trending::ClusterArticle>,
    label: Option<String>,
) -> Result<trending::StoryLineage, DiscoveryError> {
    let story = persisted.story;
    if story
        .confidence
        .is_some_and(|confidence| !confidence.is_finite())
    {
        return Err(DiscoveryError::InvalidData(
            "lineage story confidence is non-finite".to_owned(),
        ));
    }
    let lineage_story = trending::LineageStory {
        id: story.id,
        external_cluster_id: story.external_cluster_id,
        label: story.label,
        keywords: json_string_array(
            story.keywords.map(|value| value.0).unwrap_or(Value::Null),
            "lineage keywords",
        )?,
        first_seen_at: story.first_seen_at.map(format_lineage_datetime),
        last_seen_at: story.last_seen_at.map(format_lineage_datetime),
        earliest_article_id: story.earliest_article_id,
        current_summary: story.current_summary.or(label),
        confidence: story.confidence,
    };
    let article_edges = persisted
        .article_edges
        .into_iter()
        .map(|edge| {
            Ok(trending::LineageArticleEdge {
                id: Some(edge.id),
                from_article_id: edge.from_article_id,
                to_article_id: edge.to_article_id,
                from_title: articles
                    .get(&edge.from_article_id)
                    .map(|article| article.title.clone())
                    .unwrap_or_default(),
                to_title: articles
                    .get(&edge.to_article_id)
                    .map(|article| article.title.clone())
                    .unwrap_or_default(),
                relation: edge.relation,
                evidence: json_object(
                    edge.evidence.map(|value| value.0),
                    "lineage article-edge evidence",
                )?,
                confidence: finite_confidence(edge.confidence)?,
            })
        })
        .collect::<Result<Vec<_>, DiscoveryError>>()?;
    let claims = persisted
        .claims
        .into_iter()
        .map(|claim| {
            Ok(trending::LineageClaim {
                id: Some(claim.id),
                article_id: claim.article_id,
                claim_text: claim.claim_text,
                claim_type: claim.claim_type.ok_or_else(|| {
                    DiscoveryError::InvalidData("lineage claim type is missing".to_owned())
                })?,
                checkability: claim.checkability.ok_or_else(|| {
                    DiscoveryError::InvalidData("lineage claim checkability is missing".to_owned())
                })?,
                evidence_span: claim.evidence_span,
                numbers: json_string_array(
                    claim.numbers.map(|value| value.0).unwrap_or(Value::Null),
                    "lineage claim numbers",
                )?,
            })
        })
        .collect::<Result<Vec<_>, DiscoveryError>>()?;
    let claim_edges = persisted
        .claim_edges
        .into_iter()
        .map(|edge| {
            Ok(trending::LineageClaimEdge {
                id: Some(edge.id),
                from_claim_id: edge.from_claim_id,
                to_claim_id: edge.to_claim_id,
                relation: edge.relation,
                evidence: json_object(
                    edge.evidence.map(|value| value.0),
                    "lineage claim-edge evidence",
                )?,
                confidence: finite_confidence(edge.confidence)?,
            })
        })
        .collect::<Result<Vec<_>, DiscoveryError>>()?;
    let corrections = persisted
        .corrections
        .into_iter()
        .map(|correction| {
            Ok(trending::LineageCorrection {
                id: correction.id,
                source: correction.source,
                article_id: correction.article_id,
                correction_url: correction.correction_url,
                correction_text: correction.correction_text,
                corrected_claim_id: correction.corrected_claim_id,
                downstream_article_ids: json_i64_array(
                    correction
                        .downstream_article_ids
                        .map(|value| value.0)
                        .unwrap_or(Value::Null),
                    "lineage correction article IDs",
                )?,
                published_at: correction.published_at.map(format_lineage_datetime),
            })
        })
        .collect::<Result<Vec<_>, DiscoveryError>>()?;
    Ok(trending::StoryLineage {
        status: "ok".to_owned(),
        reason: None,
        story: Some(lineage_story),
        article_edges,
        claims,
        claim_edges,
        corrections,
    })
}

fn lineage_datetime(value: Option<&str>) -> Option<NaiveDateTime> {
    let value = value?;
    DateTime::parse_from_rfc3339(value)
        .map(|datetime| datetime.naive_utc())
        .ok()
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").ok())
}

fn format_lineage_datetime(value: NaiveDateTime) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
}

fn lineage_article_text(article: &trending::ClusterArticle) -> String {
    match article.summary.as_deref() {
        Some(summary) if !summary.is_empty() => format!("{} {summary}", article.title),
        _ => article.title.clone(),
    }
}

fn lineage_tokens(text: &str) -> BTreeSet<String> {
    const STOP_WORDS: &[&str] = &[
        "about", "after", "again", "against", "also", "among", "and", "are", "article", "because",
        "been", "before", "being", "between", "from", "have", "into", "more", "news", "over",
        "said", "says", "that", "the", "their", "this", "through", "under", "will", "with",
        "would",
    ];
    let mut tokens = BTreeSet::new();
    let mut token = String::new();
    for character in text.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            token.push(character);
        } else {
            if token.len() >= 3 && !STOP_WORDS.contains(&token.as_str()) {
                tokens.insert(std::mem::take(&mut token));
            } else {
                token.clear();
            }
        }
    }
    if token.len() >= 3 && !STOP_WORDS.contains(&token.as_str()) {
        tokens.insert(token);
    }
    tokens
}

fn lineage_text_similarity(left: &str, right: &str) -> f64 {
    let left = lineage_tokens(left);
    let right = lineage_tokens(right);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(&right).count();
    let union = left.len() + right.len() - intersection;
    intersection as f64 / union as f64
}

fn is_lineage_wire_source(source: &str) -> bool {
    let source = source.to_lowercase();
    [
        "ap",
        "associated press",
        "reuters",
        "afp",
        "agence france-presse",
    ]
    .iter()
    .any(|wire| source.contains(wire))
}

fn lineage_claim_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((index, character)) = chars.next() {
        if !matches!(character, '.' | '?' | '!') {
            continue;
        }
        let end = index + character.len_utf8();
        let Some((_, next)) = chars.peek().copied() else {
            continue;
        };
        if !next.is_whitespace() {
            continue;
        }
        let sentence = text[start..end].trim();
        if !sentence.is_empty() {
            sentences.push(sentence.to_owned());
        }
        let mut next_start = end;
        while let Some((whitespace_index, whitespace)) = chars.peek().copied() {
            if !whitespace.is_whitespace() {
                break;
            }
            next_start = whitespace_index + whitespace.len_utf8();
            chars.next();
        }
        start = next_start;
    }
    let remainder = text[start..].trim();
    if !remainder.is_empty() {
        sentences.push(remainder.to_owned());
    }
    sentences
        .into_iter()
        .take(8)
        .filter(|sentence| sentence.chars().count() >= 35)
        .filter(|sentence| {
            !lineage_numbers(sentence).is_empty()
                || sentence.contains('"')
                || sentence.contains('\'')
                || [
                    "said",
                    "announced",
                    "reported",
                    "confirmed",
                    "denied",
                    "ruling",
                ]
                .iter()
                .any(|term| sentence.to_lowercase().contains(term))
        })
        .take(4)
        .map(|sentence| truncate_chars(&sentence, 500))
        .collect()
}

fn lineage_numbers(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut numbers = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() || (index > 0 && is_lineage_word_byte(bytes[index - 1])) {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index + 1 < bytes.len()
            && matches!(bytes[index], b'.' | b',')
            && bytes[index + 1].is_ascii_digit()
        {
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
        }
        let end = if bytes.get(index) == Some(&b'%')
            && bytes
                .get(index + 1)
                .is_some_and(|byte| is_lineage_word_byte(*byte))
        {
            index + 1
        } else {
            index
        };
        if is_lineage_boundary(bytes, end) {
            numbers.push(text[start..end].to_owned());
            index = end;
        }
    }
    numbers
}

fn is_lineage_boundary(bytes: &[u8], index: usize) -> bool {
    let before_is_word = index > 0 && is_lineage_word_byte(bytes[index - 1]);
    let after_is_word = bytes
        .get(index)
        .is_some_and(|byte| is_lineage_word_byte(*byte));
    before_is_word != after_is_word
}

fn is_lineage_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn normalize_lineage_claim(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, ' ' | '%' | '.' | ',' | '\'' | '-')
        })
        .take(500)
        .collect()
}

fn lineage_claim_type(text: &str) -> String {
    let lowercase = text.to_lowercase();
    if text.contains('"') || text.contains('\'') {
        "quote"
    } else if ["lawsuit", "court", "judge", "ruling", "legal"]
        .iter()
        .any(|term| lowercase.contains(term))
    {
        "legal"
    } else if ["budget", "inflation", "market", "jobs", "workers"]
        .iter()
        .any(|term| lowercase.contains(term))
    {
        "economic"
    } else if !lineage_numbers(text).is_empty() {
        "number"
    } else {
        "general"
    }
    .to_owned()
}

fn json_string_array(value: Value, field: &str) -> Result<Vec<String>, DiscoveryError> {
    match value {
        Value::Null => Ok(Vec::new()),
        Value::Array(values) => values
            .into_iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    DiscoveryError::InvalidData(format!("{field} contains a non-string value"))
                })
            })
            .collect(),
        _ => Err(DiscoveryError::InvalidData(format!(
            "{field} is not a JSON array"
        ))),
    }
}

fn json_i64_array(value: Value, field: &str) -> Result<Vec<i64>, DiscoveryError> {
    match value {
        Value::Null => Ok(Vec::new()),
        Value::Array(values) => values
            .into_iter()
            .map(|value| {
                value.as_i64().ok_or_else(|| {
                    DiscoveryError::InvalidData(format!("{field} contains a non-integer value"))
                })
            })
            .collect(),
        _ => Err(DiscoveryError::InvalidData(format!(
            "{field} is not a JSON array"
        ))),
    }
}

fn json_object(
    value: Option<Value>,
    field: &str,
) -> Result<BTreeMap<String, Value>, DiscoveryError> {
    match value {
        None | Some(Value::Null) => Ok(BTreeMap::new()),
        Some(Value::Object(values)) => Ok(values.into_iter().collect()),
        Some(_) => Err(DiscoveryError::InvalidData(format!(
            "{field} is not a JSON object"
        ))),
    }
}

fn finite_confidence(value: Option<f64>) -> Result<Option<f64>, DiscoveryError> {
    if value.is_some_and(|confidence| !confidence.is_finite()) {
        return Err(DiscoveryError::InvalidData(
            "lineage edge confidence is non-finite".to_owned(),
        ));
    }
    Ok(value)
}

#[derive(Clone)]
struct GdeltEvent {
    event_root_code: Option<String>,
    tone: Option<f64>,
    goldstein_scale: Option<f64>,
}

async fn load_gdelt_events(
    database: &Database,
    article_ids: &[i64],
) -> Result<BTreeMap<i64, Vec<GdeltEvent>>, DiscoveryError> {
    if article_ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let events = database
        .list_article_gdelt_events_by_article_ids(article_ids)
        .await
        .map_err(backend_error)?;
    let mut events_by_article = BTreeMap::<i64, Vec<GdeltEvent>>::new();
    for event in events {
        let Some(article_id) = event.article_id else {
            continue;
        };
        if event.tone.is_some_and(|value| !value.is_finite())
            || event
                .goldstein_scale
                .is_some_and(|value| !value.is_finite())
        {
            return Err(DiscoveryError::InvalidData(
                "database contains a non-finite GDELT value".to_owned(),
            ));
        }
        events_by_article
            .entry(article_id)
            .or_default()
            .push(GdeltEvent {
                event_root_code: event.event_root_code,
                tone: event.tone,
                goldstein_scale: event.goldstein_scale,
            });
    }
    Ok(events_by_article)
}

fn attach_gdelt_context(
    cluster_context: &mut Option<trending::GdeltContext>,
    representative: &mut Option<trending::ClusterArticle>,
    articles: &mut [trending::ClusterArticle],
    events: &BTreeMap<i64, Vec<GdeltEvent>>,
) -> Result<(), DiscoveryError> {
    let mut article_ids = articles
        .iter()
        .map(|article| article.id)
        .collect::<BTreeSet<_>>();
    if let Some(representative) = representative.as_ref() {
        article_ids.insert(representative.id);
    }
    let context = aggregate_gdelt_context(article_ids.iter().copied(), events, None)?;
    let tone_baseline = context.as_ref().and_then(|context| context.tone_avg);
    *cluster_context = context;
    if let Some(representative) = representative {
        representative.gdelt_context =
            aggregate_gdelt_context(std::iter::once(representative.id), events, tone_baseline)?;
    }
    for article in articles {
        article.gdelt_context =
            aggregate_gdelt_context(std::iter::once(article.id), events, tone_baseline)?;
    }
    Ok(())
}

fn attach_detail_gdelt_context(
    detail: &mut trending::ClusterDetail,
    events: &BTreeMap<i64, Vec<GdeltEvent>>,
) -> Result<(), DiscoveryError> {
    let article_ids = detail
        .articles
        .iter()
        .map(|article| article.id)
        .collect::<BTreeSet<_>>();
    let context = aggregate_gdelt_context(article_ids.iter().copied(), events, None)?;
    let tone_baseline = context.as_ref().and_then(|context| context.tone_avg);
    detail.gdelt_context = context;
    for article in &mut detail.articles {
        article.gdelt_context =
            aggregate_gdelt_context(std::iter::once(article.id), events, tone_baseline)?;
    }
    Ok(())
}

fn aggregate_gdelt_context(
    article_ids: impl IntoIterator<Item = i64>,
    events_by_article: &BTreeMap<i64, Vec<GdeltEvent>>,
    tone_baseline_avg: Option<f64>,
) -> Result<Option<trending::GdeltContext>, DiscoveryError> {
    let selected = article_ids
        .into_iter()
        .filter_map(|article_id| events_by_article.get(&article_id))
        .flatten()
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Ok(None);
    }
    let tones = selected
        .iter()
        .filter_map(|event| event.tone)
        .collect::<Vec<_>>();
    let goldstein = selected
        .iter()
        .filter_map(|event| event.goldstein_scale)
        .collect::<Vec<_>>();
    let tone_avg = rounded_average(&tones);
    let goldstein_avg = rounded_average(&goldstein);
    let goldstein_min = goldstein.iter().copied().min_by(f64::total_cmp);
    let goldstein_max = goldstein.iter().copied().max_by(f64::total_cmp);
    let mut root_counts = BTreeMap::<String, i64>::new();
    for code in selected
        .iter()
        .filter_map(|event| event.event_root_code.as_deref())
        .map(str::trim)
        .filter(|code| !code.is_empty())
    {
        *root_counts.entry(code.to_owned()).or_default() += 1;
    }
    let mut top_cameo = root_counts.into_iter().collect::<Vec<_>>();
    top_cameo.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let top_cameo = top_cameo
        .into_iter()
        .take(3)
        .map(|(code, count)| trending::GdeltTopCameo {
            code: Some(code),
            label: None,
            count,
        })
        .collect();
    let tone_delta_vs_cluster = tone_avg
        .zip(tone_baseline_avg)
        .map(|(tone, baseline)| round_to(tone - baseline, 3));
    Ok(Some(trending::GdeltContext {
        total_events: checked_i64(selected.len(), "GDELT event count")?,
        top_cameo,
        goldstein_avg,
        goldstein_min: goldstein_min.map(|value| round_to(value, 3)),
        goldstein_max: goldstein_max.map(|value| round_to(value, 3)),
        goldstein_bucket: None,
        tone_avg,
        tone_baseline_avg,
        tone_delta_vs_cluster,
    }))
}

fn rounded_average(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| round_to(values.iter().sum::<f64>() / values.len() as f64, 3))
}

fn validate_embedding_rows(ids: &[String], embeddings: &[Vec<f64>]) -> Result<(), DiscoveryError> {
    if embeddings.len() != ids.len() {
        return Err(DiscoveryError::InvalidData(
            "Chroma embedding rows do not match returned IDs".to_owned(),
        ));
    }
    if embeddings
        .iter()
        .any(|embedding| embedding.is_empty() || embedding.iter().any(|value| !value.is_finite()))
    {
        return Err(DiscoveryError::InvalidData(
            "Chroma returned an empty or non-finite embedding".to_owned(),
        ));
    }
    if let Some(dimension) = embeddings.first().map(Vec::len) {
        if embeddings
            .iter()
            .any(|embedding| embedding.len() != dimension)
        {
            return Err(DiscoveryError::InvalidData(
                "Chroma embedding rows have inconsistent dimensions".to_owned(),
            ));
        }
    }
    Ok(())
}

fn embedding_rows(
    response: thesis_api::chroma::ChromaGetResponse,
) -> Result<Vec<Vec<f64>>, DiscoveryError> {
    let thesis_api::chroma::ChromaGetResponse {
        ids, embeddings, ..
    } = response;
    let Some(embeddings) = embeddings else {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        return Err(DiscoveryError::InvalidData(
            "Chroma get omitted requested embeddings".to_owned(),
        ));
    };
    validate_embedding_rows(&ids, &embeddings)?;
    Ok(embeddings)
}

fn article_embeddings_from_get(
    requested_ids: &[i64],
    response: thesis_api::chroma::ChromaGetResponse,
) -> Result<Vec<similarity::ArticleEmbedding>, DiscoveryError> {
    let thesis_api::chroma::ChromaGetResponse {
        ids, embeddings, ..
    } = response;
    let Some(embeddings) = embeddings else {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        return Err(DiscoveryError::InvalidData(
            "Chroma get omitted requested embeddings".to_owned(),
        ));
    };
    validate_embedding_rows(&ids, &embeddings)?;
    let requested = requested_ids.iter().copied().collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(ids.len());
    for (chroma_id, values) in ids.into_iter().zip(embeddings) {
        let Some(article_id) = parse_chroma_article_id(&chroma_id) else {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned an invalid article identifier".to_owned(),
            ));
        };
        if !requested.contains(&article_id) || !seen.insert(article_id) {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned an unknown or duplicate article embedding".to_owned(),
            ));
        }
        result.push(similarity::ArticleEmbedding { article_id, values });
    }
    Ok(result)
}

fn embedding_for_id(
    response: thesis_api::chroma::ChromaGetResponse,
    article_id: i64,
) -> Result<Option<Vec<f64>>, DiscoveryError> {
    let thesis_api::chroma::ChromaGetResponse {
        ids, embeddings, ..
    } = response;
    let Some(embeddings) = embeddings else {
        if ids.is_empty() {
            return Ok(None);
        }
        return Err(DiscoveryError::InvalidData(
            "Chroma get omitted requested embeddings".to_owned(),
        ));
    };
    validate_embedding_rows(&ids, &embeddings)?;
    let mut found = None;
    for (chroma_id, embedding) in ids.into_iter().zip(embeddings) {
        if parse_chroma_article_id(&chroma_id) != Some(article_id) || found.is_some() {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned an unknown or duplicate source embedding".to_owned(),
            ));
        }
        found = Some(embedding);
    }
    Ok(found)
}

fn related_hits(
    source_id: i64,
    limit: usize,
    response: &thesis_api::chroma::ChromaQueryResponse,
) -> Result<Vec<similarity::RelatedHit>, DiscoveryError> {
    let ids = response.ids.first().ok_or_else(|| {
        DiscoveryError::InvalidData("Chroma query omitted the requested result row".to_owned())
    })?;
    let distances = response
        .distances
        .as_ref()
        .and_then(|batches| batches.first())
        .ok_or_else(|| DiscoveryError::InvalidData("Chroma query omitted distances".to_owned()))?;
    if ids.len() != distances.len() {
        return Err(DiscoveryError::InvalidData(
            "Chroma related IDs and distances are misaligned".to_owned(),
        ));
    }
    let mut hits = Vec::with_capacity(limit);
    for (chroma_id, distance) in ids.iter().zip(distances) {
        if !distance.is_finite() {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned a non-finite related distance".to_owned(),
            ));
        }
        let Some(article_id) = parse_chroma_article_id(chroma_id) else {
            continue;
        };
        if article_id == source_id {
            continue;
        }
        hits.push(similarity::RelatedHit {
            article_id,
            similarity_score: 1.0 - distance,
        });
        if hits.len() >= limit {
            break;
        }
    }
    Ok(hits)
}

fn search_suggestion_rows(
    limit: usize,
    response: thesis_api::chroma::ChromaQueryResponse,
) -> Result<Vec<similarity::SearchSuggestion>, DiscoveryError> {
    let ids = response.ids.first().ok_or_else(|| {
        DiscoveryError::InvalidData("Chroma query omitted the requested result row".to_owned())
    })?;
    let distances = response
        .distances
        .as_ref()
        .and_then(|batches| batches.first())
        .ok_or_else(|| DiscoveryError::InvalidData("Chroma query omitted distances".to_owned()))?;
    let metadatas = response
        .metadatas
        .as_ref()
        .and_then(|batches| batches.first())
        .ok_or_else(|| DiscoveryError::InvalidData("Chroma query omitted metadata".to_owned()))?;
    let documents = response
        .documents
        .as_ref()
        .and_then(|batches| batches.first())
        .ok_or_else(|| DiscoveryError::InvalidData("Chroma query omitted documents".to_owned()))?;
    if ids.len() != distances.len() || ids.len() != metadatas.len() || ids.len() != documents.len()
    {
        return Err(DiscoveryError::InvalidData(
            "Chroma suggestion fields are misaligned".to_owned(),
        ));
    }
    let mut suggestions = Vec::with_capacity(limit);
    for (index, (chroma_id, distance)) in ids.iter().zip(distances).enumerate() {
        if !distance.is_finite() {
            return Err(DiscoveryError::InvalidData(
                "Chroma returned a non-finite suggestion distance".to_owned(),
            ));
        }
        let Some(cluster_id) = parse_chroma_article_id(chroma_id) else {
            continue;
        };
        let title = metadatas[index]
            .as_ref()
            .and_then(|metadata| metadata.get("title"))
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty());
        let label = title
            .map(str::to_owned)
            .or_else(|| {
                documents[index]
                    .as_deref()
                    .map(|document| truncate_chars(document, 60))
            })
            .unwrap_or_default();
        suggestions.push(similarity::SearchSuggestion {
            cluster_id,
            label,
            relevance: round_to(1.0 - distance, 3),
        });
        if suggestions.len() >= limit {
            break;
        }
    }
    Ok(suggestions)
}

fn similarity_article(
    article: DiscoveryArticleRecord,
) -> Result<similarity::SimilarityArticle, DiscoveryError> {
    let url = article
        .url
        .ok_or_else(|| DiscoveryError::InvalidData(format!("article {} has no URL", article.id)))?;
    Ok(similarity::SimilarityArticle {
        id: article.id,
        title: article.title,
        source: article.source,
        source_id: article.source_id,
        summary: article.summary,
        image: article.image_url,
        published_at: article
            .published_at
            .map(|published_at| published_at.to_rfc3339_opts(SecondsFormat::AutoSi, true)),
        category: article.category,
        url,
    })
}

fn mean_and_std(vectors: &[Vec<f64>]) -> Result<(Vec<f64>, Vec<f64>), DiscoveryError> {
    let Some(first) = vectors.first() else {
        return Ok((Vec::new(), Vec::new()));
    };
    let dimension = first.len();
    if dimension == 0
        || vectors.iter().any(|vector| {
            vector.len() != dimension || vector.iter().any(|value| !value.is_finite())
        })
    {
        return Err(DiscoveryError::InvalidData(
            "source coverage embeddings have inconsistent or invalid dimensions".to_owned(),
        ));
    }
    let mut centroid = vec![0.0; dimension];
    for vector in vectors {
        for (sum, value) in centroid.iter_mut().zip(vector) {
            *sum += *value;
        }
    }
    for value in &mut centroid {
        *value /= vectors.len() as f64;
    }
    let mut standard_deviation = vec![0.0; dimension];
    for vector in vectors {
        for ((sum, value), center) in standard_deviation.iter_mut().zip(vector).zip(&centroid) {
            *sum += (value - center).powi(2);
        }
    }
    for value in &mut standard_deviation {
        *value = (*value / vectors.len() as f64).sqrt();
    }
    Ok((centroid, standard_deviation))
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn unique_ids(ids: &[i64]) -> Vec<i64> {
    let mut seen = HashSet::with_capacity(ids.len());
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

fn article_chroma_id(article_id: i64) -> Result<String, DiscoveryError> {
    if article_id <= 0 {
        return Err(DiscoveryError::InvalidData(
            "article ID must be positive".to_owned(),
        ));
    }
    Ok(format!("{CHROMA_ARTICLE_PREFIX}{article_id}"))
}

fn chroma_article_id(article_id: i64) -> Result<String, DiscoveryError> {
    article_chroma_id(article_id)
}

fn parse_chroma_article_id(chroma_id: &str) -> Option<i64> {
    let suffix = chroma_id.strip_prefix(CHROMA_ARTICLE_PREFIX)?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let article_id = suffix.parse::<i64>().ok()?;
    (article_id > 0).then_some(article_id)
}

fn positive_usize(value: i64, label: &str) -> Result<usize, DiscoveryError> {
    usize::try_from(value)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| DiscoveryError::InvalidData(format!("{label} must be positive")))
}

fn checked_i64(value: usize, label: &str) -> Result<i64, DiscoveryError> {
    i64::try_from(value).map_err(|_| DiscoveryError::InvalidData(format!("{label} overflowed")))
}

fn window_start(window: &str) -> Result<DateTime<Utc>, DiscoveryError> {
    let duration = match window {
        "1d" => Duration::days(1),
        "1w" => Duration::weeks(1),
        "1m" => Duration::days(30),
        _ => {
            return Err(DiscoveryError::InvalidData(
                "unsupported discovery window".to_owned(),
            ));
        }
    };
    Ok(Utc::now() - duration)
}

fn recency_bonus(published_at: Option<DateTime<Utc>>) -> f64 {
    let Some(published_at) = published_at else {
        return 1.0;
    };
    let age_hours = (Utc::now() - published_at).num_minutes() as f64 / 60.0;
    if age_hours < 24.0 {
        1.5
    } else if age_hours < 72.0 {
        1.2
    } else {
        1.0
    }
}

fn round_to(value: f64, digits: u32) -> f64 {
    let factor = 10_f64.powi(digits as i32);
    (value * factor).round() / factor
}

fn backend_error(error: impl Display) -> DiscoveryError {
    DiscoveryError::Backend(error.to_string())
}

fn chroma_error(error: ChromaError) -> DiscoveryError {
    match error {
        ChromaError::Http(_)
        | ChromaError::HttpStatus { .. }
        | ChromaError::BodyTooLarge { .. } => DiscoveryError::VectorStoreUnavailable,
        ChromaError::InvalidResponse { message, .. } => DiscoveryError::InvalidData(message),
        other => backend_error(other),
    }
}

fn embedding_error(error: EmbeddingError) -> DiscoveryError {
    match error {
        EmbeddingError::Http(_)
        | EmbeddingError::HttpStatus { .. }
        | EmbeddingError::BodyTooLarge { .. } => DiscoveryError::VectorStoreUnavailable,
        EmbeddingError::InvalidResponse { message, .. } => DiscoveryError::InvalidData(message),
        other => backend_error(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        lineage_numbers, parse_chroma_article_id, ClusterDataStore,
        DatabaseChromaDiscoveryProvider, DiscoveryFuture, GdeltEvent,
    };
    use axum::body::{to_bytes, Body};
    use chrono::{Duration as ChronoDuration, Utc};
    use serde_json::{json, Value};
    use std::collections::{BTreeMap, BTreeSet};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};
    use thesis_api::chroma::{ChromaClient, ChromaConfig};
    use thesis_api::discovery::{DiscoveryError, DiscoveryProvider, DiscoveryState};
    use thesis_api::embedding::{EmbeddingClient, EmbeddingConfig};
    use thesis_db::{
        Database, DiscoveryArticleRecord, PersistedStoryLineage, StoryLineageArticleEdgeRecord,
        StoryLineageRecord, StoryLineageWrite,
    };
    use tower::ServiceExt;

    struct FixtureClusterData {
        articles: Vec<DiscoveryArticleRecord>,
        persisted_lineage: Option<thesis_db::PersistedStoryLineage>,
    }

    impl ClusterDataStore for FixtureClusterData {
        fn recent_articles(
            &self,
            since: chrono::DateTime<Utc>,
            limit: i64,
        ) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>> {
            let mut articles = self.articles.clone();
            articles.retain(|article| article.published_at.is_some_and(|time| time >= since));
            articles.sort_by(|left, right| {
                right
                    .published_at
                    .cmp(&left.published_at)
                    .then_with(|| right.id.cmp(&left.id))
            });
            articles.truncate(usize::try_from(limit).unwrap_or_default());
            Box::pin(async move { Ok(articles) })
        }

        fn articles_by_ids(&self, ids: &[i64]) -> DiscoveryFuture<Vec<DiscoveryArticleRecord>> {
            let ids = ids.iter().copied().collect::<BTreeSet<_>>();
            let mut articles = self
                .articles
                .iter()
                .filter(|article| ids.contains(&article.id))
                .cloned()
                .collect::<Vec<_>>();
            articles.sort_by_key(|article| article.id);
            Box::pin(async move { Ok(articles) })
        }

        fn gdelt_events(&self, _ids: &[i64]) -> DiscoveryFuture<BTreeMap<i64, Vec<GdeltEvent>>> {
            Box::pin(async { Ok(BTreeMap::new()) })
        }

        fn snapshot_cluster(
            &self,
            _cluster_id: i64,
        ) -> DiscoveryFuture<Option<super::trending::AllCluster>> {
            Box::pin(async { Ok(None) })
        }
        fn persist_story_lineage(
            &self,
            _write: StoryLineageWrite,
        ) -> DiscoveryFuture<Option<PersistedStoryLineage>> {
            let persisted = self.persisted_lineage.clone();
            Box::pin(async move { Ok(persisted) })
        }
    }

    fn test_provider(
        database: Database,
        cluster_data: Arc<dyn ClusterDataStore>,
        chroma: ChromaClient,
    ) -> DatabaseChromaDiscoveryProvider {
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("build no-proxy test HTTP client");
        let embedding = EmbeddingClient::new(
            http,
            EmbeddingConfig::new("http://127.0.0.1:1", Duration::from_secs(1))
                .expect("valid unused embedding endpoint"),
        );
        DatabaseChromaDiscoveryProvider {
            database,
            cluster_data,
            chroma,
            embedding,
        }
    }

    fn database() -> Database {
        Database::connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
            .expect("valid lazy database URL")
    }

    fn mock_chroma(
        status: u16,
        body: &'static str,
        request_count: usize,
    ) -> (ChromaClient, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock Chroma");
        listener
            .set_nonblocking(true)
            .expect("enable timed mock Chroma accept");
        let address = listener.local_addr().expect("read mock Chroma address");
        let server = thread::spawn(move || {
            for _ in 0..request_count {
                let deadline = Instant::now() + Duration::from_secs(3);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(connection) => break connection,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(error) => panic!("timed out accepting Chroma request: {error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("set Chroma read timeout");
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request).expect("read Chroma request");
                let response = format!(
                    "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write Chroma response");
            }
        });
        let config = ChromaConfig::new(
            &format!("http://{address}"),
            "default_tenant",
            "default_database",
            "news-articles",
            Duration::from_secs(1),
        )
        .expect("valid mock Chroma configuration");
        (
            ChromaClient::new(
                reqwest::Client::builder()
                    .no_proxy()
                    .build()
                    .expect("build no-proxy Chroma test client"),
                config,
            ),
            server,
        )
    }

    fn lexical_fixture() -> Arc<FixtureClusterData> {
        let newest = Utc::now() - ChronoDuration::minutes(10);
        let earlier = newest - ChronoDuration::minutes(20);
        Arc::new(FixtureClusterData {
            articles: vec![
                article(
                    20,
                    "President Trump executive order targets immigration",
                    "Wire One",
                    newest,
                ),
                article(
                    10,
                    "Trump signs executive order on border security",
                    "Wire Two",
                    earlier,
                ),
            ],
            persisted_lineage: None,
        })
    }
    fn persisted_lineage_fixture() -> PersistedStoryLineage {
        let now = Utc::now().naive_utc();
        PersistedStoryLineage {
            story: StoryLineageRecord {
                id: 77,
                external_cluster_id: 20,
                label: Some("Persisted topic".to_owned()),
                keywords: None,
                first_seen_at: Some(now),
                last_seen_at: Some(now),
                earliest_article_id: Some(10),
                current_summary: Some("Persisted summary".to_owned()),
                confidence: Some(0.8),
                created_at: None,
                updated_at: None,
            },
            article_edges: vec![StoryLineageArticleEdgeRecord {
                id: 91,
                story_cluster_id: 77,
                from_article_id: 10,
                to_article_id: 20,
                relation: "likely_source".to_owned(),
                evidence: None,
                confidence: Some(0.7),
                created_at: None,
            }],
            claims: Vec::new(),
            claim_edges: Vec::new(),
            corrections: Vec::new(),
        }
    }

    fn article(
        id: i64,
        title: &str,
        source: &str,
        published_at: chrono::DateTime<Utc>,
    ) -> DiscoveryArticleRecord {
        DiscoveryArticleRecord {
            id,
            title: title.to_owned(),
            source: source.to_owned(),
            source_id: None,
            summary: Some(title.to_owned()),
            image_url: None,
            published_at: Some(published_at),
            category: None,
            url: Some(format!("https://example.test/articles/{id}")),
            content: Some(title.to_owned()),
            author: None,
            authors: Vec::new(),
            credibility: None,
        }
    }

    #[test]
    fn chroma_ids_require_the_article_prefix_and_positive_decimal_id() {
        assert_eq!(parse_chroma_article_id("article_42"), Some(42));
        assert_eq!(parse_chroma_article_id("article_0"), None);
        assert_eq!(parse_chroma_article_id("article_-1"), None);
        assert_eq!(parse_chroma_article_id("article_42_extra"), None);
        assert_eq!(parse_chroma_article_id("42"), None);
    }
    #[test]
    fn lineage_article_edges_link_only_from_the_earliest_article() {
        let article = |id: i64, published_at: &str| super::trending::ClusterArticle {
            id,
            title: format!("Article {id} reports a public policy update"),
            source: format!("Source {id}"),
            source_id: None,
            url: String::new(),
            image_url: None,
            published_at: Some(published_at.to_owned()),
            summary: None,
            similarity: None,
            author: None,
            authors: Vec::new(),
            gdelt_context: None,
        };
        let articles = [
            article(10, "2025-01-01T00:00:00Z"),
            article(20, "2025-01-02T00:00:00Z"),
            article(30, "2025-01-03T00:00:00Z"),
        ];

        let edges = super::build_lineage_article_edges(&articles);
        assert_eq!(edges.len(), 2);
        assert!(edges.iter().all(|edge| edge.from_article_id == 10));
        assert_eq!(
            edges
                .iter()
                .map(|edge| edge.to_article_id)
                .collect::<Vec<_>>(),
            vec![20, 30]
        );
    }
    #[test]
    fn lineage_number_percent_backtracking_matches_python_regex_boundary() {
        assert_eq!(
            lineage_numbers("10% and 12.5%"),
            vec!["10".to_owned(), "12.5".to_owned()]
        );
        assert_eq!(
            lineage_numbers("10% 10%rate"),
            vec!["10".to_owned(), "10%".to_owned()]
        );
        assert_eq!(
            lineage_numbers("10%x and 12.5%y"),
            vec!["10%".to_owned(), "12.5%".to_owned()]
        );
    }

    #[tokio::test]
    async fn lexical_titles_flow_through_trending_snapshot_and_detail_without_neighbor_queries() {
        let (chroma, server) = mock_chroma(200, r#"{"nanosecond heartbeat":1}"#, 2);
        let provider = test_provider(database(), lexical_fixture(), chroma);

        let trending = provider
            .trending_clusters("1d".to_owned(), 10)
            .await
            .expect("trending uses lexical candidates after heartbeat");
        assert_eq!(trending.len(), 1);
        assert_eq!(trending[0].cluster_id, 20);
        assert_eq!(trending[0].article_count, 2);
        assert!(trending[0]
            .articles
            .iter()
            .all(|article| article.similarity.is_none()));

        let breaking = provider
            .breaking_clusters(5)
            .await
            .expect("breaking uses lexical candidates after heartbeat");
        assert_eq!(breaking.len(), 1);
        assert_eq!(breaking[0].cluster_id, 20);

        let clusters = provider
            .all_clusters("1d".to_owned(), 2, 10)
            .await
            .expect("snapshot computation uses lexical candidates");
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].cluster_id, 20);
        assert_eq!(clusters[0].article_count, 2);

        let detail = provider
            .cluster_detail(20)
            .await
            .expect("detail fallback uses lexical candidates")
            .expect("lexical cluster found");
        assert_eq!(detail.id, 20);
        assert_eq!(detail.article_count, 2);
        assert_eq!(detail.articles.len(), 2);
        assert!(detail
            .articles
            .iter()
            .all(|article| article.similarity.is_some()));
        assert!(detail.articles.iter().all(|article| {
            article.summary.is_none()
                && article.author.is_none()
                && article.authors.is_empty()
                && article.source_id.is_none()
        }));

        server.join().expect("mock Chroma server completed");
    }

    #[tokio::test]
    async fn lineage_route_serializes_persisted_rows_after_lexical_detail_fallback() {
        let fixture = lexical_fixture();
        let cluster_data = Arc::new(FixtureClusterData {
            articles: fixture.articles.clone(),
            persisted_lineage: Some(persisted_lineage_fixture()),
        });
        let (chroma, server) = mock_chroma(503, "", 0);
        let database = database();
        let provider = Arc::new(test_provider(database.clone(), cluster_data, chroma));
        let state = DiscoveryState::with_adapters(Some(provider), None);
        let app = thesis_api::router_with_sidecars(
            database,
            thesis_api::RouterSidecars::default().with_discovery(state),
        );
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/trending/clusters/20/lineage")
                    .body(Body::empty())
                    .expect("build lineage request"),
            )
            .await
            .expect("lineage route response");
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("read lineage response");
        let lineage: Value = serde_json::from_slice(&body).expect("decode lineage response");
        assert_eq!(lineage["status"], "ok");
        assert_eq!(lineage["story"]["id"], 77);
        assert_eq!(lineage["story"]["external_cluster_id"], 20);
        assert_eq!(lineage["story"]["keywords"], json!([]));
        assert_eq!(
            lineage["article_edges"][0]["from_title"],
            "Trump signs executive order on border security"
        );
        assert_eq!(
            lineage["article_edges"][0]["to_title"],
            "President Trump executive order targets immigration"
        );
        assert_eq!(lineage["article_edges"][0]["evidence"], json!({}));
        server.join().expect("unused Chroma fixture completed");
    }

    #[tokio::test]
    async fn stats_heartbeat_failure_serializes_the_fastapi_zero_payload_without_database_access() {
        let (chroma, server) = mock_chroma(503, "", 2);
        let database = database();
        let provider = Arc::new(test_provider(
            database.clone(),
            Arc::new(FixtureClusterData {
                articles: Vec::new(),
                persisted_lineage: None,
            }),
            chroma,
        ));
        assert_eq!(
            provider.trending_stats().await.unwrap_err(),
            DiscoveryError::VectorStoreUnavailable
        );
        let state = DiscoveryState::with_adapters(Some(provider), None);
        let app = thesis_api::router_with_sidecars(
            database,
            thesis_api::RouterSidecars::default().with_discovery(state),
        );
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/trending/stats")
                    .body(Body::empty())
                    .expect("build stats request"),
            )
            .await
            .expect("stats route response");
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = to_bytes(response.into_body(), 8_192)
            .await
            .expect("read stats response");
        let stats: Value = serde_json::from_slice(&body).expect("decode stats response");
        assert_eq!(
            stats,
            json!({
                "active_clusters": 0,
                "baseline_days": 0,
                "breaking_window_hours": 3,
                "recent_spikes": 0,
                "similarity_threshold": 0.0,
                "total_article_assignments": 0
            })
        );
        server.join().expect("mock Chroma server completed");
    }
}
