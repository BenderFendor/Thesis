/// Public contracts for caller-supplied article extraction and analysis sidecars.
pub mod article_analysis;
pub mod blindspots;
pub mod cache_stream;
/// Typed Chroma collection HTTP client shared by runtime integrations.
pub mod chroma;
mod claims;
mod comparison;
mod core;
pub mod debug;
pub mod discovery;
/// Typed embedding-service HTTP client shared by runtime integrations.
pub mod embedding;
pub mod entity_research;
pub mod gdelt;
mod highlights;
mod http_middleware;
/// Public contracts for inline-definition provider integrations.
pub mod inline;
mod interest;
/// Public contracts for job and image sidecar integrations.
pub mod jobs_image;
mod library;
mod models;
mod news;
mod news_by_country;
mod news_cache;
#[cfg(test)]
mod news_cache_tests;
/// Public contracts for news research retrieval and provider integrations.
pub mod news_research;
/// Schema-hidden process resource-observability endpoints.
pub mod observability;
mod profiling;
pub use profiling::ProfilingState;
pub mod queue_digest;
#[cfg(test)]
mod queue_digest_tests;
mod ranking;
mod reading_queue;
mod relationships;
/// Public contracts for semantic-search provider integrations.
pub mod search;
pub mod source_catalog;
/// Environment-backed verification policy and provider contracts.
pub mod verification;
pub mod wiki;
mod wiki_atlas;

use axum::body::Bytes;
use axum::extract::{FromRef, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use models::{
    parse_evaluation_request, AcceptanceEvaluationRequest, AcceptanceEvaluationResponse,
    HttpValidationError,
};
use thesis_db::Database;
use thesis_evidence::evaluate_acceptance;
pub use thesis_ingest::html_extract::extract_og_image_from_html;
use utoipa::OpenApi;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) database: Database,
    pub(crate) database_enabled: bool,
    pub(crate) profiling: profiling::ProfilingState,
    pub(crate) source_catalog: source_catalog::SourceCatalogState,
    pub(crate) entity_research: entity_research::EntityResearchState,
    pub(crate) jobs_image: jobs_image::JobsImageState,
    pub(crate) cache_stream: cache_stream::CacheStreamState,
    pub(crate) article_analysis: article_analysis::ArticleAnalysisState,
    pub(crate) queue_digest: queue_digest::QueueDigestState,
}

fn database_enabled_value(value: Option<&str>) -> bool {
    !matches!(value, Some("0" | "false" | "False" | ""))
}

fn database_enabled_from_environment() -> bool {
    database_enabled_value(std::env::var("ENABLE_DATABASE").ok().as_deref())
}

impl FromRef<AppState> for queue_digest::QueueDigestState {
    fn from_ref(state: &AppState) -> Self {
        state.queue_digest.clone()
    }
}

impl FromRef<AppState> for profiling::ProfilingState {
    fn from_ref(state: &AppState) -> Self {
        state.profiling.clone()
    }
}

impl FromRef<AppState> for source_catalog::SourceCatalogState {
    fn from_ref(state: &AppState) -> Self {
        state.source_catalog.clone()
    }
}

impl FromRef<AppState> for entity_research::EntityResearchState {
    fn from_ref(state: &AppState) -> Self {
        state.entity_research.clone()
    }
}

impl FromRef<AppState> for jobs_image::JobsImageState {
    fn from_ref(state: &AppState) -> Self {
        state.jobs_image.clone()
    }
}

impl FromRef<AppState> for cache_stream::CacheStreamState {
    fn from_ref(state: &AppState) -> Self {
        state.cache_stream.clone()
    }
}

impl FromRef<AppState> for article_analysis::ArticleAnalysisState {
    fn from_ref(state: &AppState) -> Self {
        state.article_analysis.clone()
    }
}

/// Sidecar state configured for the Rust-owned routes.
///
/// The default leaves every external provider integration explicitly unavailable.
#[derive(Clone)]
pub struct RouterSidecars {
    jobs_image: jobs_image::JobsImageState,
    cache_stream: cache_stream::CacheStreamState,
    discovery: discovery::DiscoveryState,
    article_analysis: article_analysis::ArticleAnalysisState,
    queue_digest: queue_digest::QueueDigestState,
    semantic_search: search::SemanticSearchState,
    inline_definition: inline::InlineDefinitionState,
    news_research: news_research::NewsResearchState,
    gdelt_sync: gdelt::GdeltSyncState,
    blindspots: blindspots::BlindspotAnalysisState,
    profiling: ProfilingState,
    source_catalog: source_catalog::SourceCatalogState,
    entity_research: entity_research::EntityResearchState,
    wiki: wiki::WikiState,
    debug_config: Option<debug::DebugConfig>,
    debug_providers: debug::DebugProviders,
    verification: verification::VerificationState,
    observability: observability::Observability,
}
impl Default for RouterSidecars {
    fn default() -> Self {
        Self {
            jobs_image: jobs_image::JobsImageState::default(),
            cache_stream: cache_stream::CacheStreamState::default(),
            discovery: discovery::DiscoveryState::default(),
            article_analysis: article_analysis::ArticleAnalysisState::unavailable(),
            queue_digest: queue_digest::QueueDigestState::unavailable(),
            semantic_search: search::SemanticSearchState { provider: None },
            inline_definition: inline::InlineDefinitionState::default(),
            news_research: news_research::NewsResearchState::unavailable(),
            gdelt_sync: gdelt::GdeltSyncState::unavailable(),
            blindspots: blindspots::BlindspotAnalysisState::unavailable(),
            profiling: ProfilingState::new(),
            source_catalog: source_catalog::SourceCatalogState::default(),
            entity_research: entity_research::EntityResearchState::default(),
            debug_config: None,
            debug_providers: debug::DebugProviders::default(),
            verification: verification::VerificationState::from_environment(),
            observability: observability::Observability::from_env(),
        }
    }
}

impl RouterSidecars {
    /// Replace the unavailable jobs and image providers with supplied sidecars.
    pub fn with_jobs_image(mut self, state: jobs_image::JobsImageState) -> Self {
        self.jobs_image = state;
        self
    }

    /// Replace the default cache and updates state with a supplied sidecar state.
    pub fn with_cache_stream(mut self, state: cache_stream::CacheStreamState) -> Self {
        self.cache_stream = state;
        self
    }

    /// Replace the unavailable discovery providers with supplied adapters.
    pub fn with_discovery(mut self, state: discovery::DiscoveryState) -> Self {
        self.discovery = state;
        self
    }

    /// Replace the unavailable article extraction and analysis sidecars.
    pub fn with_article_analysis(mut self, state: article_analysis::ArticleAnalysisState) -> Self {
        self.article_analysis = state;
        self
    }

    /// Replace the unavailable AI digest provider with the supplied provider.
    pub fn with_queue_digest(mut self, state: queue_digest::QueueDigestState) -> Self {
        self.queue_digest = state;
        self
    }
    /// Replace the unavailable semantic-search provider with a supplied adapter.
    pub fn with_semantic_search(mut self, state: search::SemanticSearchState) -> Self {
        self.semantic_search = state;
        self
    }

    /// Replace the unavailable inline-definition provider with a supplied adapter.
    pub fn with_inline_definition(mut self, state: inline::InlineDefinitionState) -> Self {
        self.inline_definition = state;
        self
    }

    /// Replace the unavailable research integration with a supplied provider state.
    pub fn with_news_research(mut self, state: news_research::NewsResearchState) -> Self {
        self.news_research = state;
        self
    }
    /// Attach the live GDELT ingestion provider.
    pub fn with_gdelt_sync(mut self, state: gdelt::GdeltSyncState) -> Self {
        self.gdelt_sync = state;
        self
    }

    /// Attach live source/topic blindspot analysis.
    pub fn with_blindspots(mut self, state: blindspots::BlindspotAnalysisState) -> Self {
        self.blindspots = state;
        self
    }
    pub fn with_profiling(mut self, state: ProfilingState) -> Self {
        self.profiling = state;
        self
    }

    pub fn with_source_catalog(mut self, state: source_catalog::SourceCatalogState) -> Self {
        self.source_catalog = state;
        self
    }

    pub fn with_entity_research(mut self, state: entity_research::EntityResearchState) -> Self {
        self.entity_research = state;
        self
    }

    pub fn with_wiki(mut self, state: wiki::WikiState) -> Self {
        self.wiki = state;
        self
    }

    /// Configure debug routes against the router's shared process state.
    pub fn with_debug(
        mut self,
        config: debug::DebugConfig,
        providers: debug::DebugProviders,
    ) -> Self {
        self.debug_config = Some(config);
        self.debug_providers = providers;
        self
    }

    pub fn with_verification(mut self, state: verification::VerificationState) -> Self {
        self.verification = state;
        self
    }

    pub fn with_observability(mut self, state: observability::Observability) -> Self {
        self.observability = state;
        self
    }
}

/// Build the Rust-owned route subset with explicitly unavailable sidecars.
pub fn router(database: Database) -> Router {
    router_with_sidecars(database, RouterSidecars::default())
}

/// Build the Rust shadow router with the selected provider sidecars.
pub fn router_with_sidecars(database: Database, sidecars: RouterSidecars) -> Router {
    let database_enabled = sidecars
        .debug_config
        .as_ref()
        .map_or_else(database_enabled_from_environment, |config| {
            config.enable_database
        });
    let debug_enabled = sidecars
        .debug_config
        .as_ref()
        .is_some_and(|config| config.debug_mode);
    let debug_router = sidecars.debug_config.map(|config| {
        debug::router(debug::DebugState::build(
            database.clone(),
            sidecars.cache_stream.clone(),
            sidecars.jobs_image.clone(),
            sidecars.source_catalog.clone(),
            sidecars.profiling.clone(),
            config,
            sidecars.debug_providers,
        ))
    });
    let mut router = Router::new()
        .route("/", get(read_root))
        .route("/health", get(health_check))
        .route("/categories", get(core::get_categories))
        .route("/cache/refresh", post(cache_stream::manual_cache_refresh))
        .route(
            "/cache/refresh/stream",
            post(cache_stream::stream_cache_refresh),
        )
        .route("/cache/status", get(cache_stream::get_cache_status))
        .route(
            "/api/article/language-diagnostics",
            post(core::analyze_article_language),
        )
        .route(
            "/article/extract",
            get(article_analysis::get_article_extract),
        )
        .route(
            "/api/article/analyze",
            post(article_analysis::post_article_analysis),
        )
        .route("/api/wiki/evidence/policies", get(get_evidence_policies))
        .route(
            "/api/wiki/evidence/claims/{claim_id}",
            get(claims::get_claim),
        )
        .route(
            "/api/wiki/evidence/claims/{claim_id}/materialize",
            post(claims::materialize_claim),
        )
        .route(
            "/api/wiki/evidence/relationships",
            get(relationships::get_relationships),
        )
        .route(
            "/api/wiki/evidence/interest",
            get(interest::get_ownership_interest),
        )
        .route("/api/wiki/evidence/claims/evaluate", post(evaluate_claim))
        .route(
            "/news/page/cached",
            get(news_cache::get_cached_news_paginated),
        )
        .route(
            "/debug/cache/articles",
            get(news_cache::list_cached_articles_debug),
        )
        .route("/debug/startup", get(debug::get_startup_metrics))
        .route(
            "/debug/database/articles",
            get(debug::list_database_articles),
        )
        .route(
            "/news/index/cached",
            get(news_cache::get_cached_browse_index),
        )
        .route(
            "/news/source/{source_name}",
            get(news_cache::get_news_by_source),
        )
        .route(
            "/news/category/{category_name}",
            get(news_cache::get_news_by_category),
        )
        .route("/news/sources/stats", get(news_cache::get_source_stats))
        .route("/news/page", get(news::get_news_paginated))
        .route("/news/index", get(news::get_browse_index))
        .route("/news/recent", get(news::get_recent_news))
        .route("/news/sources", get(news::get_sources))
        .route("/news/stream", get(cache_stream::stream_news))
        .route("/updates/stream", get(cache_stream::updates_stream))
        .route("/updates/status", get(cache_stream::get_updates_status))
        .route("/profiling/metrics", get(profiling::metrics))
        .route("/profiling/summary", get(profiling::profiling_summary))
        .route("/profiling/bottlenecks", get(profiling::bottlenecks))
        .route("/profiling/queries", get(profiling::query_stats))
        .route("/profiling/startup", get(profiling::startup_stats))
        .route("/profiling/slow-endpoints", get(profiling::slow_endpoints))
        .route("/profiling/reset", post(profiling::reset_profiling))
        .route("/profiling/health", get(profiling::profiling_health))
        .route("/sources", get(source_catalog::get_sources))
        .route("/sources/add-rss", post(source_catalog::add_rss_source))
        .route(
            "/sources/rss/validate",
            post(source_catalog::validate_rss_source),
        )
        .route(
            "/sources/rss/promote",
            post(source_catalog::promote_rss_source),
        )
        .route(
            "/sources/{domain}/credibility",
            get(source_catalog::get_source_credibility),
        )
        .route(
            "/research/entity/reporter/profile",
            post(entity_research::profile_reporter),
        )
        .route(
            "/research/entity/reporter/{reporter_id}",
            get(entity_research::get_reporter),
        )
        .route(
            "/research/entity/organization/research",
            post(entity_research::research_organization),
        )
        .route(
            "/research/entity/source/profile",
            post(entity_research::research_source_profile),
        )
        .route(
            "/research/entity/source/batch",
            post(entity_research::research_source_batch),
        )
        .route(
            "/research/entity/organization/{org_id}",
            get(entity_research::get_organization),
        )
        .route(
            "/research/entity/organization/{org_name}/ownership-chain",
            get(entity_research::get_ownership_chain),
        )
        .route(
            "/research/entity/reporters",
            get(entity_research::list_reporters),
        )
        .route(
            "/research/entity/organizations",
            get(entity_research::list_organizations),
        )
        .route(
            "/research/entity/material-context",
            post(entity_research::analyze_material_context),
        )
        .route(
            "/research/entity/country/{country_code}/economic-profile",
            get(entity_research::get_country_economic_profile),
        )
        .route("/jobs/refresh", post(jobs_image::start_refresh_job))
        .route(
            "/jobs/{job_id}/stream",
            get(jobs_image::stream_job_progress),
        )
        .route("/jobs/{job_id}/status", get(jobs_image::get_job_status))
        .route("/image/proxy", get(jobs_image::proxy_image))
        .route("/image/cache/stats", get(jobs_image::get_cache_stats))
        .route("/image/cache/clear", delete(jobs_image::clear_cache))
        .route("/image/og", get(jobs_image::get_og_image))
        .route("/news/categories", get(news::get_categories))
        .route(
            "/news/countries/geo",
            get(news_by_country::get_countries_geo_data_route),
        )
        .route(
            "/news/by-country",
            get(news_by_country::get_article_counts_by_country),
        )
        .route(
            "/news/country/{code}",
            get(news_by_country::get_news_for_country),
        )
        .route(
            "/news/countries/list",
            get(news_by_country::list_available_countries),
        )
        .route("/api/queue/add", post(reading_queue::add_to_queue))
        .route(
            "/api/queue/{queue_id}",
            delete(reading_queue::remove_from_queue).patch(reading_queue::update_queue_item),
        )
        .route(
            "/api/queue/url/{*article_url}",
            delete(reading_queue::remove_from_queue_by_url),
        )
        .route("/api/queue", get(reading_queue::get_queue))
        .route(
            "/api/queue/maintenance/move-expired",
            post(reading_queue::move_expired_items),
        )
        .route(
            "/api/queue/overview",
            get(reading_queue::get_queue_overview),
        )
        .route(
            "/api/queue/shelves",
            get(reading_queue::get_shelves).post(reading_queue::create_shelf),
        )
        .route(
            "/api/queue/shelves/{shelf_id}",
            patch(reading_queue::update_shelf),
        )
        .route(
            "/api/queue/maintenance/archive",
            post(reading_queue::archive_completed_items),
        )
        .route(
            "/api/queue/{queue_id}/content",
            get(reading_queue::get_queue_item_content),
        )
        .route(
            "/api/queue/digest/daily",
            get(reading_queue::get_daily_digest),
        )
        .route("/api/queue/digest", post(queue_digest::generate_ai_digest))
        .route(
            "/api/queue/highlights",
            get(highlights::get_all_highlights).post(highlights::create_highlight),
        )
        .route(
            "/api/queue/highlights/article/{*article_url}",
            get(highlights::get_article_highlights),
        )
        .route(
            "/api/queue/highlights/{highlight_id}",
            patch(highlights::update_highlight).delete(highlights::delete_highlight),
        )
        .route(
            "/api/bookmarks",
            get(library::list_bookmarks).post(library::create_bookmark),
        )
        .route(
            "/api/bookmarks/{article_id}",
            get(library::get_bookmark)
                .put(library::update_bookmark)
                .delete(library::delete_bookmark),
        )
        .route(
            "/api/liked",
            get(library::list_liked_articles).post(library::create_liked_article),
        )
        .route(
            "/api/liked/{article_id}",
            get(library::get_liked_article).delete(library::delete_liked_article),
        )
        .route("/news/ranked", post(ranking::post_ranked_articles))
        .route("/compare/articles", post(comparison::post_compare_articles))
        .merge(wiki::router_with_indexing(sidecars.wiki))
        .merge(wiki_atlas::router())
        .merge(gdelt::router(sidecars.gdelt_sync))
        .merge(blindspots::router(sidecars.blindspots))
        .with_state(AppState {
            database,
            database_enabled,
            profiling: sidecars.profiling.clone(),
            source_catalog: sidecars.source_catalog,
            entity_research: sidecars.entity_research,
            jobs_image: sidecars.jobs_image,
            cache_stream: sidecars.cache_stream,
            article_analysis: sidecars.article_analysis,
            queue_digest: sidecars.queue_digest,
        })
        .merge(verification::router(sidecars.verification))
        .merge(search::router(sidecars.semantic_search))
        .merge(inline::router(sidecars.inline_definition))
        .merge(news_research::router(sidecars.news_research))
        .merge(observability::router(sidecars.observability))
        .layer(profiling::middleware_layer(sidecars.profiling.clone()));
    if let Some(debug_router) = debug_router {
        router = router.merge(debug_router);
    }
    let router = if debug_enabled {
        router.route("/openapi.json", get(openapi_json))
    } else {
        router
    };
    http_middleware::apply(router)
}

#[derive(OpenApi)]
#[openapi(
    paths(
        core::read_root,
        core::health_check,
        core::get_categories,
        core::analyze_article_language,
        article_analysis::get_article_extract,
        article_analysis::post_article_analysis,
        get_evidence_policies,
        claims::get_claim,
        claims::materialize_claim,
        relationships::get_relationships,
        interest::get_ownership_interest,
        jobs_image::start_refresh_job,
        jobs_image::stream_job_progress,
        jobs_image::get_job_status,
        jobs_image::proxy_image,
        jobs_image::get_cache_stats,
        jobs_image::clear_cache,
        jobs_image::get_og_image,
        cache_stream::manual_cache_refresh,
        cache_stream::stream_cache_refresh,
        cache_stream::get_cache_status,
        cache_stream::stream_news,
        cache_stream::updates_stream,
        cache_stream::get_updates_status,
        evaluate_claim,
        search::semantic_search,
        inline::define_inline,
        news_research::research_models_endpoint,
        news_research::news_research_stream_endpoint,
        news_research::news_research_endpoint,
        gdelt::get_article_gdelt_events,
        gdelt::get_gdelt_stats,
        gdelt::get_recent_gdelt_events,
        gdelt::trigger_gdelt_sync,
        blindspots::get_blindspot_viewer,
        blindspots::get_source_blind_spots,
        blindspots::get_topic_blind_spots,
        blindspots::get_coverage_report,
        blindspots::get_blind_spots_dashboard,
        blindspots::update_coverage_stats,
        verification::get_verification_status,
        verification::list_allowed_domains,
        verification::verify_claims,
        verification::verify_claims_json,
        verification::verify_claims_stream,
        verification::clear_cache,
        debug::get_frontend_debug_reports,
        debug::ingest_frontend_debug_report,
        debug::get_debug_events,
        debug::list_debug_log_files,
        debug::clear_old_log_files,
        debug::read_debug_log_file,
        debug::get_source_debug_data,
        debug::get_stream_status,
        debug::get_pipeline_metrics,
        debug::get_startup_metrics,
        debug::list_chromadb_articles,
        debug::list_database_articles,
        debug::get_cache_db_delta,
        debug::get_storage_drift,
        debug::get_system_status,
        debug::get_log_level,
        debug::set_log_level,
        debug::test_rss_parser,
        debug::test_article_parser,
        debug::list_active_jobs,
        debug::get_updates_subscribers,
        debug::get_debug_report,
        debug::get_streams,
        debug::get_slow_operations,
        debug::get_performance_summary,
        debug::get_llm_logs,
        debug::get_debug_errors,
        debug::backfill_article_images,
        debug::backfill_article_mentions,
        wiki::list_wiki_sources,
        wiki::get_source_wiki,
        wiki::get_source_reporters,
        wiki::list_wiki_reporters,
        wiki::get_reporter_dossier,
        wiki::get_reporter_articles,
        wiki::list_wiki_organizations,
        wiki::get_wiki_index_status,
        wiki_atlas::get_atlas_ingestion_status,
        wiki_atlas::get_funding_bias_analysis,
        wiki_atlas::get_media_measurements,
        wiki_atlas::get_graph,
        wiki_atlas::get_connections,
        wiki_atlas::get_atlas_search,
        wiki_atlas::get_atlas_index,
        wiki_atlas::export_atlas,
        wiki_atlas::get_atlas_stats,
        news::get_news_paginated,
        news::get_browse_index,
        news::get_recent_news,
        news::get_sources,
        news_cache::get_cached_news_paginated,
        news_cache::get_cached_browse_index,
        news_cache::get_news_by_source,
        news_cache::get_news_by_category,
        news_cache::get_source_stats,
        news_cache::list_cached_articles_debug,
        profiling::metrics,
        profiling::profiling_summary,
        profiling::bottlenecks,
        profiling::query_stats,
        profiling::startup_stats,
        profiling::slow_endpoints,
        profiling::reset_profiling,
        profiling::profiling_health,
        source_catalog::get_sources,
        source_catalog::add_rss_source,
        source_catalog::validate_rss_source,
        source_catalog::promote_rss_source,
        source_catalog::get_source_credibility,
        entity_research::profile_reporter,
        entity_research::get_reporter,
        entity_research::research_organization,
        entity_research::research_source_profile,
        entity_research::research_source_batch,
        entity_research::get_organization,
        entity_research::get_ownership_chain,
        entity_research::list_reporters,
        entity_research::list_organizations,
        entity_research::analyze_material_context,
        entity_research::get_country_economic_profile,
        news::get_categories,
        news_by_country::get_countries_geo_data_route,
        news_by_country::get_article_counts_by_country,
        news_by_country::get_news_for_country,
        news_by_country::list_available_countries,
        reading_queue::add_to_queue,
        reading_queue::remove_from_queue,
        reading_queue::update_queue_item,
        reading_queue::remove_from_queue_by_url,
        reading_queue::get_queue,
        reading_queue::move_expired_items,
        reading_queue::get_queue_overview,
        reading_queue::get_shelves,
        reading_queue::create_shelf,
        reading_queue::update_shelf,
        reading_queue::archive_completed_items,
        reading_queue::get_queue_item_content,
        reading_queue::get_daily_digest,
        queue_digest::generate_ai_digest,
        highlights::get_all_highlights,
        highlights::create_highlight,
        highlights::get_article_highlights,
        highlights::update_highlight,
        highlights::delete_highlight,
        library::list_bookmarks,
        library::create_bookmark,
        library::get_bookmark,
        library::update_bookmark,
        library::delete_bookmark,
        library::list_liked_articles,
        library::create_liked_article,
        library::get_liked_article,
        library::delete_liked_article,
        ranking::post_ranked_articles,
        comparison::post_compare_articles,
        discovery::trending::get_trending,
        discovery::trending::get_breaking,
        discovery::trending::get_all_clusters,
        discovery::trending::get_cluster_detail,
        discovery::trending::get_cluster_contradictions,
        discovery::trending::get_cluster_lineage,
        discovery::trending::get_trending_stats,
        discovery::similarity::get_related_articles,
        discovery::similarity::get_search_suggestions,
        discovery::similarity::get_source_coverage,
        discovery::similarity::compute_novelty_score,
        discovery::similarity::get_article_topics,
        discovery::similarity::get_bulk_article_topics
    ),
    components(schemas(
        AcceptanceEvaluationRequest,
        AcceptanceEvaluationResponse,
        models::EvidencePolicyRecord,
        claims::ClaimResponse,
        claims::ObservationResponse,
        claims::ClaimStatus,
        claims::EntailmentStatus,
        relationships::RelationshipResponse,
        relationships::RelationshipListResponse,
        relationships::RelationshipStatus,
        interest::OwnershipInterestPath,
        interest::OwnershipInterestResponse,
        models::RankRequest,
        models::RankResponse,
        models::HttpValidationError,
        models::ValidationError,
        models::ValidationLocation,
        search::SemanticSearchResult,
        search::SemanticSearchResponse,
        inline::InlineDefineRequest,
        inline::InlineDefineResponse,
        news_research::NewsResearchRequest,
        news_research::NewsResearchResponse,
        news_research::ResearchModelCatalog,
        news_research::ResearchModelOption,
        news_research::ThinkingStep,
        blindspots::BlindspotViewerResponse,
        gdelt::GdeltObjectSchema,
        gdelt::GdeltEventListSchema,
        blindspots::SourceBlindSpotsResponse,
        blindspots::TopicBlindSpotResponse,
        blindspots::CoverageReportResponse,
        blindspots::BlindspotDashboardResponse,
        blindspots::BlindspotStatsUpdateResponse,
        verification::VerificationObjectResponseSchema,
        verification::VerificationRequest,
        verification::VerificationResult,
        verification::VerificationStreamResponseSchema,
        debug::FrontendDebugReport,
        debug::StartupMetricsResponse,
        debug::StartupEventResponse,
        wiki::SourceCardResponse,
        wiki::SourceWikiResponse,
        wiki::ReporterCardResponse,
        wiki::ReporterDossierResponse,
        wiki::WikiIndexStatusResponse,
        wiki::WikiFreeFormObjectSchema,
        wiki_atlas::AtlasIngestStatusResponse,
        wiki_atlas::FundingBiasAnalysisResponse,
        jobs_image::JobStartResponse,
        jobs_image::JobStatusResponse,
        jobs_image::ImageObjectSchema,
        jobs_image::StringObjectSchema,
        cache_stream::CacheStatusResponse,
        cache_stream::CacheRefreshStringMapSchema,
        cache_stream::UpdatesStatusFreeFormSchema,
        comparison::ComparisonRequest,
        comparison::ComparisonResponse,
        core::LanguageDiagnosticsRequest,
        core::LanguageDiagnosticsResponse,
        core::LanguageDiagnosticExample,
        core::LanguageDiagnosticMetric,
        core::LanguageDiagnosticOverall,
        core::LanguageDiagnosticStatus,
        article_analysis::ArticleAnalysisRequest,
        article_analysis::ArticleAnalysisResponse,
        article_analysis::DiagnosticStatus,
        article_analysis::LanguageDiagnosticExample,
        article_analysis::LanguageDiagnosticMetric,
        article_analysis::LanguageDiagnosticOverall,
        article_analysis::LanguageDiagnosticsResponse,
        news::NewsArticleResponse,
        news::PaginatedNewsResponse,
        news::BrowseIndexNewsResponse,
        news::RecentNewsResponse,
        news::NewsSourceResponse,
        news_cache::CachedNewsArticleResponse,
        news_cache::CachedNewsResponse,
        news_cache::CachedSourceStats,
        news_cache::CachedSourceStatsList,
        news_cache::CacheDebugArticleResponse,
        news_cache::CacheDebugArticlesResponse,
        news::CategoriesResponse,
        news_by_country::CountryGeoData,
        reading_queue::AddToQueueRequest,
        reading_queue::UpdateQueueItemRequest,
        reading_queue::ReadingQueueItem,
        reading_queue::QueueResponse,
        reading_queue::QueueOverviewResponse,
        reading_queue::ReadingShelf,
        reading_queue::CreateShelfRequest,
        reading_queue::UpdateShelfRequest,
        queue_digest::QueueDigestRequestSchema,
        queue_digest::QueueDigestResponse,
        highlights::CreateHighlightRequest,
        highlights::UpdateHighlightRequest,
        highlights::HighlightResponse,
        library::BookmarkCreateRequest,
        library::BookmarkEntry,
        library::BookmarkListResponse,
        library::LikedEntry,
        library::LikedListResponse,
        source_catalog::SourceUrlValue,
        source_catalog::SourceCatalogEntry,
        source_catalog::AddRssRequest,
        source_catalog::PromoteRssRequest,
        source_catalog::DuplicateCandidate,
        source_catalog::InferredSource,
        source_catalog::SampleArticle,
        source_catalog::RssValidationResponse,
        source_catalog::FreeFormObjectSchema,
        profiling::ProfilingObjectSchema,
        profiling::ProfilingStringMapSchema,
        entity_research::ReporterProfileRequest,
        entity_research::OrganizationResearchRequest,
        entity_research::SourceResearchRequest,
        entity_research::SourceBatchRequest,
        entity_research::MaterialContextRequest,
        entity_research::ReporterProfileResponse,
        entity_research::OrganizationResearchResponse,
        entity_research::SourceResearchValue,
        entity_research::SourceReporterSummary,
        entity_research::SourceResearchResponse,
        entity_research::SourceBatchResponse,
        entity_research::OwnershipChainResponse,
        entity_research::MaterialContextResponse,
        discovery::trending::GdeltTopCameo,
        discovery::trending::GdeltContext,
        discovery::trending::ClusterArticle,
        discovery::trending::TrendingCluster,
        discovery::trending::BreakingCluster,
        discovery::trending::AllCluster,
        discovery::trending::ClusterDetail,
        discovery::trending::ContradictionEvidence,
        discovery::trending::ContradictionClaim,
        discovery::trending::AgreedFact,
        discovery::trending::ContradictionPanel,
        discovery::trending::LineageStory,
        discovery::trending::LineageArticleEdge,
        discovery::trending::LineageClaim,
        discovery::trending::LineageClaimEdge,
        discovery::trending::LineageCorrection,
        discovery::trending::StoryLineage,
        discovery::trending::TrendingStats,
        discovery::similarity::SimilarityArticle,
        discovery::similarity::SearchSuggestion,
        discovery::similarity::ArticleTopic,
    )),
    info(title = "Thesis API", version = "0.1.0")
)]
pub struct ApiDoc;

async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
async fn read_root() -> impl IntoResponse {
    core::read_root().await
}

async fn health_check() -> impl IntoResponse {
    core::health_check().await
}

#[utoipa::path(
    get,
    path = "/api/wiki/evidence/policies",
    operation_id = "get_evidence_policies_api_wiki_evidence_policies_get",
    responses((
        status = 200,
        description = "Successful Response",
        body = [models::EvidencePolicyRecord]
    ))
)]
async fn get_evidence_policies() -> Json<Vec<models::EvidencePolicyRecord>> {
    Json(
        thesis_evidence::policies()
            .iter()
            .map(|policy| models::EvidencePolicyRecord {
                predicate: policy.predicate.clone(),
                version: policy.version.clone(),
                allowed_evidence_classes: policy.allowed_evidence_classes.clone(),
                minimum_independent_roots: policy.minimum_independent_roots,
                requires_complete_path: policy.requires_complete_path,
                permits_catalog_only: policy.permits_catalog_only,
            })
            .collect(),
    )
}

#[utoipa::path(
    post,
    path = "/api/wiki/evidence/claims/evaluate",
    operation_id = "evaluate_evidence_claim_api_wiki_evidence_claims_evaluate_post",
    request_body = AcceptanceEvaluationRequest,
    responses(
        (status = 200, description = "Successful Response", body = AcceptanceEvaluationResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn evaluate_claim(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_evaluation_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    match state.database.load_claim_evidence(&request.claim_id).await {
        Ok(Some(claim)) => {
            let decision = evaluate_acceptance(
                &claim.predicate,
                &claim.observations,
                request.complete_control_path,
            );
            Json(AcceptanceEvaluationResponse {
                claim_id: request.claim_id,
                accepted: decision.accepted,
                policy_version: decision.policy_version,
                reasons: decision.reasons,
                independent_root_count: decision.independent_root_count,
                qualifying_observation_count: decision.qualifying_observation_count,
            })
            .into_response()
        }
        Ok(None) => {
            let detail = format!("claim '{}' does not exist", request.claim_id);
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"detail": detail})),
            )
                .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "evidence claim evaluation query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{cache_stream, router, router_with_sidecars, ApiDoc, RouterSidecars};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use futures_util::StreamExt;
    use thesis_db::Database;
    use tower::ServiceExt;
    use utoipa::OpenApi;

    #[test]
    fn database_debug_enable_database_setting_matches_fastapi_environment_values() {
        assert!(super::database_enabled_value(None));
        assert!(super::database_enabled_value(Some("1")));
        assert!(super::database_enabled_value(Some("TRUE")));

        for value in ["0", "false", "False", ""] {
            assert!(
                !super::database_enabled_value(Some(value)),
                "{value:?} must disable the database debug route"
            );
        }
    }

    #[tokio::test]
    async fn database_debug_articles_are_root_mounted_and_validate_before_database_access() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let response = app
            .clone()
            .oneshot(
                Request::get("/debug/database/articles?sort_direction=sideways")
                    .body(Body::empty())
                    .expect("invalid sort request"),
            )
            .await
            .expect("sort validation response");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("sort validation response body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("sort validation response JSON");
        assert_eq!(payload["detail"], "sort_direction must be 'asc' or 'desc'");

        let response = app
            .oneshot(
                Request::get("/debug/database/articles?missing_embeddings_only=%20true")
                    .body(Body::empty())
                    .expect("whitespace boolean request"),
            )
            .await
            .expect("boolean validation response");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("boolean validation response body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("boolean validation response JSON");
        assert_eq!(payload["detail"][0]["type"], "bool_parsing");
        assert_eq!(
            payload["detail"][0]["loc"],
            serde_json::json!(["query", "missing_embeddings_only"])
        );
    }

    #[tokio::test]
    async fn database_debug_articles_returns_unavailable_when_database_is_disabled() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time after epoch")
            .as_nanos();
        let log_directory = std::env::temp_dir().join(format!("thesis-debug-database-{unique}"));
        let mut config = crate::debug::DebugConfig::for_test(log_directory.clone());
        config.enable_database = false;
        let sidecars =
            RouterSidecars::default().with_debug(config, crate::debug::DebugProviders::default());
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router_with_sidecars(database, sidecars)
            .oneshot(
                Request::get("/debug/database/articles")
                    .body(Body::empty())
                    .expect("database articles request"),
            )
            .await
            .expect("database availability response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("database availability response body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("database availability response JSON");
        assert_eq!(payload["detail"], "Database unavailable");
        std::fs::remove_dir_all(log_directory).expect("remove isolated debug log directory");
    }

    #[test]
    fn database_debug_articles_openapi_matches_fastapi_operation_contract() {
        let json = ApiDoc::openapi().to_json().expect("OpenAPI JSON");
        let document: serde_json::Value =
            serde_json::from_str(&json).expect("valid generated OpenAPI JSON");
        let operation = &document["paths"]["/debug/database/articles"]["get"];
        assert_eq!(
            operation["operationId"],
            "list_database_articles_debug_database_articles_get"
        );
        assert_eq!(
            operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/DatabaseDebugResponse"
        );
        let responses = operation["responses"]
            .as_object()
            .expect("database article response object");
        assert_eq!(responses.len(), 2);
        assert!(responses.contains_key("200"));
        assert!(responses.contains_key("422"));

        let parameters = operation["parameters"]
            .as_array()
            .expect("database article query parameters");
        let parameter_names = parameters
            .iter()
            .map(|parameter| parameter["name"].as_str().expect("query parameter name"))
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            parameter_names,
            std::collections::BTreeSet::from([
                "limit",
                "missing_embeddings_only",
                "offset",
                "published_after",
                "published_before",
                "sort_direction",
                "source",
            ])
        );
        for (name, default) in [
            ("limit", serde_json::json!(50)),
            ("offset", serde_json::json!(0)),
            ("missing_embeddings_only", serde_json::json!(false)),
            ("sort_direction", serde_json::json!("desc")),
        ] {
            let parameter = parameters
                .iter()
                .find(|parameter| parameter["name"] == name)
                .unwrap_or_else(|| panic!("missing {name} query parameter"));
            assert_eq!(parameter["schema"]["default"], default);
        }
    }
    #[test]
    fn rust_openapi_contains_the_existing_operation_id_and_statuses() {
        let json = ApiDoc::openapi().to_json().expect("OpenAPI JSON");
        let document: serde_json::Value =
            serde_json::from_str(&json).expect("valid generated OpenAPI JSON");
        let operation = &document["paths"]["/api/wiki/evidence/claims/evaluate"]["post"];
        assert_eq!(
            operation["operationId"],
            "evaluate_evidence_claim_api_wiki_evidence_claims_evaluate_post"
        );
        assert!(operation["responses"]["200"].is_object());
        assert!(operation["responses"]["422"].is_object());
        let materialize =
            &document["paths"]["/api/wiki/evidence/claims/{claim_id}/materialize"]["post"];
        assert_eq!(
            materialize["operationId"],
            "materialize_evidence_claim_api_wiki_evidence_claims__claim_id__materialize_post"
        );
        assert!(materialize["responses"]["200"].is_object());
        assert!(materialize["responses"]["422"].is_object());
        assert_eq!(
            materialize["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/AcceptedRelationshipRecord"
        );
        let materialize_parameters = materialize["parameters"]
            .as_array()
            .expect("materialization parameters");
        for (name, location, required) in [
            ("claim_id", "path", true),
            ("complete_control_path", "query", false),
            ("X-Scoop-Reviewer", "header", true),
            ("X-Scoop-Materialize-Token", "header", false),
        ] {
            let parameter = materialize_parameters
                .iter()
                .find(|parameter| parameter["name"] == name)
                .unwrap_or_else(|| panic!("missing {name} parameter"));
            assert_eq!(parameter["in"], location);
            assert_eq!(parameter["required"], required);
        }
        let complete_control_path = materialize_parameters
            .iter()
            .find(|parameter| parameter["name"] == "complete_control_path")
            .expect("complete_control_path parameter");
        assert_eq!(complete_control_path["schema"]["type"], "boolean");
        assert_eq!(complete_control_path["schema"]["default"], false);
        let policies = &document["paths"]["/api/wiki/evidence/policies"]["get"];
        assert_eq!(
            policies["operationId"],
            "get_evidence_policies_api_wiki_evidence_policies_get"
        );
        let required = document["components"]["schemas"]["EvidencePolicyRecord"]["required"]
            .as_array()
            .expect("policy required fields");
        assert_eq!(
            required,
            &vec![
                "predicate",
                "version",
                "allowed_evidence_classes",
                "minimum_independent_roots"
            ]
            .into_iter()
            .map(serde_json::Value::from)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            document["components"]["schemas"]["EvidencePolicyRecord"]["properties"]
                ["requires_complete_path"]["default"],
            false
        );
        assert_eq!(
            document["components"]["schemas"]["EvidencePolicyRecord"]["properties"]
                ["permits_catalog_only"]["default"],
            false
        );
        let ranking = &document["paths"]["/news/ranked"]["post"];
        assert_eq!(
            ranking["operationId"],
            "post_ranked_articles_news_ranked_post"
        );
        assert!(ranking["responses"]["200"].is_object());
        assert!(ranking["responses"]["422"].is_object());
        let comparison = &document["paths"]["/compare/articles"]["post"];
        assert_eq!(
            comparison["operationId"],
            "compare_two_articles_compare_articles_post"
        );
        assert!(comparison["responses"]["200"].is_object());
        assert!(comparison["responses"]["422"].is_object());
        let semantic_search = &document["paths"]["/api/search/semantic"]["get"];
        assert_eq!(
            semantic_search["operationId"],
            "semantic_search_api_search_semantic_get"
        );
        assert!(semantic_search["responses"]["200"].is_object());
        assert!(semantic_search["responses"]["422"].is_object());
        let inline = &document["paths"]["/api/inline/define"]["post"];
        assert_eq!(
            inline["operationId"],
            "define_inline_api_inline_define_post"
        );
        assert!(inline["responses"]["200"].is_object());
        assert!(inline["responses"]["422"].is_object());

        for (path, method, operation_id) in [
            (
                "/api/news/research/models",
                "get",
                "research_models_endpoint_api_news_research_models_get",
            ),
            (
                "/api/news/research/stream",
                "get",
                "news_research_stream_endpoint_api_news_research_stream_get",
            ),
            (
                "/api/news/research",
                "post",
                "news_research_endpoint_api_news_research_post",
            ),
            (
                "/debug/logs/frontend",
                "get",
                "get_frontend_debug_reports_debug_logs_frontend_get",
            ),
            (
                "/debug/logs/frontend",
                "post",
                "ingest_frontend_debug_report_debug_logs_frontend_post",
            ),
            (
                "/debug/logs/files",
                "get",
                "list_debug_log_files_debug_logs_files_get",
            ),
            (
                "/debug/logs/files",
                "delete",
                "clear_old_log_files_debug_logs_files_delete",
            ),
            (
                "/debug/logs/file/{filename}",
                "get",
                "read_debug_log_file_debug_logs_file__filename__get",
            ),
            (
                "/debug/logs/events",
                "get",
                "get_debug_events_debug_logs_events_get",
            ),
            (
                "/gdelt/article/{article_id}",
                "get",
                "get_article_gdelt_events_gdelt_article__article_id__get",
            ),
            ("/gdelt/stats", "get", "get_gdelt_stats_gdelt_stats_get"),
            (
                "/gdelt/recent",
                "get",
                "get_recent_gdelt_events_gdelt_recent_get",
            ),
            ("/gdelt/sync", "post", "trigger_gdelt_sync_gdelt_sync_post"),
            (
                "/blindspots/source/{source_name}",
                "get",
                "get_source_blind_spots_blindspots_source__source_name__get",
            ),
            (
                "/blindspots/topics",
                "get",
                "get_topic_blind_spots_blindspots_topics_get",
            ),
            (
                "/blindspots/report",
                "get",
                "get_coverage_report_blindspots_report_get",
            ),
            (
                "/blindspots/dashboard",
                "get",
                "get_blind_spots_dashboard_blindspots_dashboard_get",
            ),
            (
                "/blindspots/update-stats",
                "post",
                "update_coverage_stats_blindspots_update_stats_post",
            ),
            (
                "/blindspots/viewer",
                "get",
                "get_blindspot_viewer_blindspots_viewer_get",
            ),
            (
                "/api/verification/status",
                "get",
                "get_verification_status_api_verification_status_get",
            ),
            (
                "/api/verification/verify",
                "post",
                "verify_claims_api_verification_verify_post",
            ),
            (
                "/api/verification/verify/json",
                "post",
                "verify_claims_json_api_verification_verify_json_post",
            ),
            (
                "/api/verification/verify/stream",
                "post",
                "verify_claims_stream_api_verification_verify_stream_post",
            ),
            (
                "/api/verification/cache",
                "delete",
                "clear_cache_api_verification_cache_delete",
            ),
            (
                "/api/verification/domains",
                "get",
                "list_allowed_domains_api_verification_domains_get",
            ),
            (
                "/api/wiki/sources",
                "get",
                "list_wiki_sources_api_wiki_sources_get",
            ),
            (
                "/api/wiki/sources/{source_name}",
                "get",
                "get_source_wiki_api_wiki_sources__source_name__get",
            ),
            (
                "/api/wiki/sources/{source_name}/reporters",
                "get",
                "get_source_reporters_api_wiki_sources__source_name__reporters_get",
            ),
            (
                "/api/wiki/reporters",
                "get",
                "list_wiki_reporters_api_wiki_reporters_get",
            ),
            (
                "/api/wiki/reporters/{reporter_id}",
                "get",
                "get_reporter_dossier_api_wiki_reporters__reporter_id__get",
            ),
            (
                "/api/wiki/reporters/{reporter_id}/articles",
                "get",
                "get_reporter_articles_api_wiki_reporters__reporter_id__articles_get",
            ),
            (
                "/api/wiki/organizations",
                "get",
                "list_wiki_organizations_api_wiki_organizations_get",
            ),
            (
                "/api/wiki/index/status",
                "get",
                "get_wiki_index_status_api_wiki_index_status_get",
            ),
            (
                "/api/wiki/atlas/ingestion-status",
                "get",
                "get_atlas_ingestion_status_api_wiki_atlas_ingestion_status_get",
            ),
            (
                "/api/wiki/atlas/analysis/funding-bias",
                "get",
                "get_funding_bias_analysis_api_wiki_atlas_analysis_funding_bias_get",
            ),
            (
                "/api/wiki/atlas/graph",
                "get",
                "get_atlas_graph_api_wiki_atlas_graph_get",
            ),
            (
                "/api/wiki/atlas/entities/{entity_id}/connections",
                "get",
                "get_atlas_entity_connections_api_wiki_atlas_entities__entity_id__connections_get",
            ),
            (
                "/api/wiki/atlas/index",
                "get",
                "get_atlas_index_api_wiki_atlas_index_get",
            ),
            (
                "/api/wiki/atlas/search",
                "get",
                "search_atlas_entities_api_wiki_atlas_search_get",
            ),
            (
                "/api/wiki/atlas/export",
                "post",
                "export_atlas_api_wiki_atlas_export_post",
            ),
            (
                "/api/wiki/atlas/stats",
                "get",
                "get_atlas_stats_api_wiki_atlas_stats_get",
            ),
        ] {
            let operation = &document["paths"][path][method];
            assert_eq!(operation["operationId"], operation_id);
            assert!(operation["responses"]["200"].is_object());
        }
        let atlas_index = &document["paths"]["/api/wiki/atlas/index"]["get"];
        assert!(atlas_index["responses"]["422"].is_object());
        let atlas_export = &document["paths"]["/api/wiki/atlas/export"]["post"];
        assert!(atlas_export["responses"]["422"].is_object());
        let request_schema = &atlas_export["requestBody"]["content"]["application/json"]["schema"];
        assert_eq!(
            request_schema["$ref"],
            "#/components/schemas/AtlasExportRequest"
        );
        assert!(
            document["components"]["schemas"]["AtlasExportRequest"].is_object(),
            "Atlas export request schema is registered"
        );
        let atlas_stats = &document["paths"]["/api/wiki/atlas/stats"]["get"];
        assert_eq!(
            atlas_stats["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/AtlasStatsResponse"
        );
        assert!(
            document["components"]["schemas"]["AtlasStatsResponse"].is_object(),
            "Atlas stats response schema is registered"
        );
        for (path, method, operation_id) in [
            (
                "/jobs/refresh",
                "post",
                "start_refresh_job_jobs_refresh_post",
            ),
            (
                "/jobs/{job_id}/stream",
                "get",
                "stream_job_progress_jobs__job_id__stream_get",
            ),
            (
                "/jobs/{job_id}/status",
                "get",
                "get_job_status_jobs__job_id__status_get",
            ),
            ("/image/proxy", "get", "proxy_image_image_proxy_get"),
            (
                "/image/cache/stats",
                "get",
                "get_cache_stats_image_cache_stats_get",
            ),
            (
                "/image/cache/clear",
                "delete",
                "clear_cache_image_cache_clear_delete",
            ),
            ("/image/og", "get", "get_og_image_image_og_get"),
        ] {
            assert_eq!(document["paths"][path][method]["operationId"], operation_id);
        }
        for (path, method, operation_id) in [
            (
                "/cache/refresh",
                "post",
                "manual_cache_refresh_cache_refresh_post",
            ),
            (
                "/cache/refresh/stream",
                "post",
                "stream_cache_refresh_cache_refresh_stream_post",
            ),
            ("/cache/status", "get", "get_cache_status_cache_status_get"),
            ("/news/stream", "get", "stream_news_news_stream_get"),
            (
                "/updates/stream",
                "get",
                "updates_stream_updates_stream_get",
            ),
            (
                "/updates/status",
                "get",
                "get_updates_status_updates_status_get",
            ),
        ] {
            assert_eq!(document["paths"][path][method]["operationId"], operation_id);
        }
        for (path, method) in [
            ("/gdelt/sync", "post"),
            ("/blindspots/source/{source_name}", "get"),
            ("/blindspots/topics", "get"),
            ("/blindspots/report", "get"),
            ("/blindspots/dashboard", "get"),
            ("/blindspots/update-stats", "post"),
            ("/blindspots/viewer", "get"),
        ] {
            assert!(
                document["paths"][path][method].is_object(),
                "{method} {path}"
            );
        }
        for schema in [
            "StartupMetricsResponse",
            "StartupEventResponse",
            "GdeltObjectSchema",
            "GdeltEventListSchema",
            "SourceBlindSpotsResponse",
            "TopicBlindSpotResponse",
            "CoverageReportResponse",
            "BlindspotDashboardResponse",
            "BlindspotStatsUpdateResponse",
            "BlindspotViewerResponse",
            "VerificationObjectResponseSchema",
            "VerificationRequest",
            "VerificationResult",
            "VerificationStreamResponseSchema",
        ] {
            assert!(
                document["components"]["schemas"][schema].is_object(),
                "missing OpenAPI schema {schema}"
            );
        }
        for path in [
            "/api/verification/verify",
            "/api/verification/verify/json",
            "/api/verification/verify/stream",
        ] {
            let operation = &document["paths"][path]["post"];
            assert!(
                operation["requestBody"]["content"].is_object(),
                "missing request body schema for {path}"
            );
            assert!(
                operation["responses"]["200"]["content"].is_object(),
                "missing success schema for {path}"
            );
        }
        assert!(
            document["paths"]["/api/verification/cache"]["delete"]["responses"]["200"]["content"]
                .is_object(),
            "missing cache success schema"
        );
    }

    #[test]
    fn rust_openapi_matches_fastapi_for_all_shadow_operation_ids() {
        use std::collections::{BTreeMap, BTreeSet};

        fn operations_by_path_and_method(
            document: &serde_json::Value,
        ) -> BTreeMap<(String, String), String> {
            let mut operations = BTreeMap::new();
            for (path, path_item) in document["paths"].as_object().expect("OpenAPI paths object") {
                let path_item = path_item.as_object().expect("OpenAPI path item");
                for (method, operation) in path_item {
                    let Some(operation_id) = operation["operationId"].as_str() else {
                        continue;
                    };
                    operations.insert((path.clone(), method.clone()), operation_id.to_owned());
                }
            }
            operations
        }

        let rust_document: serde_json::Value = serde_json::from_str(
            &ApiDoc::openapi()
                .to_json()
                .expect("generated Rust OpenAPI JSON"),
        )
        .expect("valid Rust OpenAPI document");
        let fastapi_document: serde_json::Value =
            serde_json::from_str(include_str!("../../../../backend/openapi.json"))
                .expect("valid FastAPI OpenAPI document");
        let inventory: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../docs/agents/rust-openapi-operation-inventory.json"
        ))
        .expect("valid Rust migration inventory");
        let migrated_count = inventory["counts"]["migrated_operations"]
            .as_u64()
            .expect("migrated operation count") as usize;
        let shadow_ids = inventory["shadow_operation_ids"]
            .as_array()
            .expect("shadow operation IDs")
            .iter()
            .map(|operation_id| operation_id.as_str().expect("operation ID").to_owned())
            .collect::<BTreeSet<_>>();
        assert_eq!(shadow_ids.len(), migrated_count);

        let rust_operations = operations_by_path_and_method(&rust_document)
            .into_iter()
            .filter(|(_, operation_id)| shadow_ids.contains(operation_id))
            .collect::<BTreeMap<_, _>>();
        let expected_fastapi_operations = operations_by_path_and_method(&fastapi_document)
            .into_iter()
            .filter(|(_, operation_id)| shadow_ids.contains(operation_id))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(expected_fastapi_operations.len(), migrated_count);
        assert_eq!(rust_operations, expected_fastapi_operations);
    }

    #[tokio::test]
    async fn startup_metrics_are_available_without_debug_mode_and_leave_debug_streams_optional() {
        use std::collections::BTreeMap;
        use std::time::{Duration, SystemTime};

        use crate::profiling::ProfilingState;

        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let profiling = ProfilingState::new();
        let mut metadata = BTreeMap::new();
        metadata.insert("component".to_owned(), serde_json::json!("cache"));
        profiling.record_startup_event(
            "cache".to_owned(),
            SystemTime::now() - Duration::from_secs(1),
            Some("loaded".to_owned()),
            metadata,
        );
        profiling.add_startup_note("source", serde_json::json!("test"));
        let app = router_with_sidecars(
            database,
            RouterSidecars::default().with_profiling(profiling),
        );

        let response = app
            .clone()
            .oneshot(
                Request::get("/debug/startup")
                    .body(Body::empty())
                    .expect("startup request"),
            )
            .await
            .expect("startup response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("startup response body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("startup response JSON");
        for field in [
            "completed_at",
            "duration_seconds",
            "events",
            "notes",
            "started_at",
        ] {
            assert!(
                payload.get(field).is_some(),
                "missing response field {field}"
            );
        }
        assert_eq!(payload["notes"]["source"], "test");
        assert_eq!(payload["events"][0]["name"], "cache");
        assert_eq!(payload["events"][0]["detail"], "loaded");
        assert_eq!(payload["events"][0]["metadata"]["component"], "cache");

        let response = app
            .oneshot(
                Request::get("/debug/streams")
                    .body(Body::empty())
                    .expect("other debug request"),
            )
            .await
            .expect("other debug response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn startup_route_does_not_conflict_with_optional_debug_router() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time after epoch")
            .as_nanos();
        let log_directory = std::env::temp_dir().join(format!(
            "thesis-debug-startup-{}-{unique}",
            std::process::id()
        ));
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let sidecars = RouterSidecars::default().with_debug(
            crate::debug::DebugConfig::for_test(log_directory.clone()),
            crate::debug::DebugProviders::default(),
        );
        let response = router_with_sidecars(database, sidecars)
            .oneshot(
                Request::get("/debug/startup")
                    .body(Body::empty())
                    .expect("startup request"),
            )
            .await
            .expect("startup response");
        assert_eq!(response.status(), StatusCode::OK);
        std::fs::remove_dir_all(log_directory).expect("remove isolated debug log directory");
    }

    #[test]
    fn debug_startup_openapi_matches_fastapi_success_contract() {
        let json = ApiDoc::openapi().to_json().expect("OpenAPI JSON");
        let document: serde_json::Value =
            serde_json::from_str(&json).expect("valid generated OpenAPI JSON");
        let operation = &document["paths"]["/debug/startup"]["get"];
        assert_eq!(
            operation["operationId"],
            "get_startup_metrics_debug_startup_get"
        );
        assert_eq!(
            operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/StartupMetricsResponse"
        );
        let responses = operation["responses"]
            .as_object()
            .expect("startup response object");
        assert_eq!(responses.len(), 1);
        assert!(responses.contains_key("200"));
    }

    #[tokio::test]
    async fn discovery_route_uses_default_unavailable_provider() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router(database)
            .oneshot(
                Request::get("/api/similarity/search-suggestions?query=war")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("discovery response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("discovery response body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("discovery JSON");
        assert_eq!(body["detail"], "Vector store not available");
    }
    #[tokio::test]
    async fn research_routes_preserve_unavailable_provider_contracts() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let search = app
            .clone()
            .oneshot(
                Request::get("/api/search/semantic?query=climate")
                    .body(Body::empty())
                    .expect("search request"),
            )
            .await
            .expect("search response");
        assert_eq!(search.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(search.into_body(), 16_384)
            .await
            .expect("search response body");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("search JSON"),
            serde_json::json!({"detail": "Vector store is not available"})
        );

        let inline = app
            .clone()
            .oneshot(
                Request::post("/api/inline/define")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"term":"Janet Yellen"}"#))
                    .expect("inline request"),
            )
            .await
            .expect("inline response");
        assert_eq!(inline.status(), StatusCode::OK);
        let body = to_bytes(inline.into_body(), 16_384)
            .await
            .expect("inline response body");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("inline JSON"),
            serde_json::json!({
                "success": false,
                "term": "Janet Yellen",
                "definition": null,
                "error": "OpenRouter API key not configured"
            })
        );

        let research_models = app
            .clone()
            .oneshot(
                Request::get("/api/news/research/models")
                    .body(Body::empty())
                    .expect("research models request"),
            )
            .await
            .expect("research models response");
        assert_eq!(research_models.status(), StatusCode::OK);
        let models = to_bytes(research_models.into_body(), 16_384)
            .await
            .expect("research models body");
        let models: serde_json::Value =
            serde_json::from_slice(&models).expect("research models JSON");
        assert!(models["provider"].as_str().is_some());
        assert!(models["models"].is_array());

        let research = app
            .clone()
            .oneshot(
                Request::post("/api/news/research")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"query":"climate policy"}"#))
                    .expect("research request"),
            )
            .await
            .expect("research response");
        assert_eq!(research.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let research_body = to_bytes(research.into_body(), 16_384)
            .await
            .expect("research response body");
        assert_eq!(research_body.as_ref(), b"Internal Server Error");

        let research_stream = app
            .clone()
            .oneshot(
                Request::get("/api/news/research/stream?query=climate")
                    .body(Body::empty())
                    .expect("research stream request"),
            )
            .await
            .expect("research stream response");
        assert_eq!(research_stream.status(), StatusCode::OK);
        assert_eq!(
            research_stream.headers()[axum::http::header::CONTENT_TYPE],
            "text/event-stream"
        );
        let stream_body = to_bytes(research_stream.into_body(), 16_384)
            .await
            .expect("research stream body");
        assert!(stream_body.starts_with(b"data: "));
    }

    #[tokio::test]
    async fn analytics_read_routes_preserve_validation_contracts() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let gdelt = app
            .clone()
            .oneshot(
                Request::get("/gdelt/stats?hours=0")
                    .body(Body::empty())
                    .expect("GDELT stats request"),
            )
            .await
            .expect("GDELT stats response");
        assert_eq!(gdelt.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(gdelt.into_body(), 16_384)
            .await
            .expect("GDELT validation body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("GDELT validation JSON");
        assert_eq!(
            body["detail"][0]["loc"],
            serde_json::json!(["query", "hours"])
        );
        assert_eq!(body["detail"][0]["type"], "greater_than_equal");

        let blindspots = app
            .oneshot(
                Request::get("/blindspots/viewer?lens=unsupported")
                    .body(Body::empty())
                    .expect("blindspot viewer request"),
            )
            .await
            .expect("blindspot viewer response");
        assert_eq!(blindspots.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(blindspots.into_body(), 16_384)
            .await
            .expect("blindspot validation body");
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("blindspot validation JSON");
        assert_eq!(
            body["detail"][0]["loc"],
            serde_json::json!(["query", "lens"])
        );
        assert_eq!(body["detail"][0]["type"], "literal_error");
    }

    #[tokio::test]
    async fn verification_status_and_domains_use_environment_config() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let status = app
            .clone()
            .oneshot(
                Request::get("/api/verification/status")
                    .body(Body::empty())
                    .expect("verification status request"),
            )
            .await
            .expect("verification status response");
        assert_eq!(status.status(), StatusCode::OK);
        let body = to_bytes(status.into_body(), 16_384)
            .await
            .expect("verification status body");
        let status: serde_json::Value =
            serde_json::from_slice(&body).expect("verification status JSON");
        assert!(status["enabled"].is_boolean());
        for field in [
            "max_duration_seconds",
            "max_claims",
            "max_sources_per_claim",
            "cache_ttl_hours",
            "allowed_domains_count",
        ] {
            assert!(status[field].as_i64().is_some(), "status field {field}");
        }
        assert!(status["recheck_threshold"].as_f64().is_some());

        let domains = app
            .oneshot(
                Request::get("/api/verification/domains")
                    .body(Body::empty())
                    .expect("verification domains request"),
            )
            .await
            .expect("verification domains response");
        assert_eq!(domains.status(), StatusCode::OK);
        let body = to_bytes(domains.into_body(), 16_384)
            .await
            .expect("verification domains body");
        let domains: serde_json::Value =
            serde_json::from_slice(&body).expect("verification domains JSON");
        let domain_list = domains["domains"]
            .as_array()
            .expect("verification domains array");
        assert_eq!(domains["count"].as_u64(), Some(domain_list.len() as u64));
        assert!(domain_list.iter().all(serde_json::Value::is_string));
    }

    #[tokio::test]
    async fn article_analysis_routes_use_default_unavailable_sidecars() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let extraction = app
            .clone()
            .oneshot(
                Request::get("/article/extract?url=https%3A%2F%2Fexample.com%2Fstory")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("extraction response");
        assert_eq!(extraction.status(), StatusCode::OK);
        let body = to_bytes(extraction.into_body(), 16_384)
            .await
            .expect("extraction response body");
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("extraction response JSON");
        assert_eq!(
            body,
            serde_json::json!({
                "success": false,
                "url": "https://example.com/story",
                "error": "Article extraction sidecar is unavailable"
            })
        );

        let analysis = app
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"url":"https://example.com/story"}"#))
                    .expect("request"),
            )
            .await
            .expect("analysis response");
        assert_eq!(analysis.status(), StatusCode::OK);
        let body = to_bytes(analysis.into_body(), 16_384)
            .await
            .expect("analysis response body");
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("analysis response JSON");
        assert_eq!(
            body,
            serde_json::json!({
                "success": false,
                "article_url": "https://example.com/story",
                "full_text": null,
                "title": null,
                "authors": null,
                "publish_date": null,
                "source_analysis": null,
                "reporter_analysis": null,
                "bias_analysis": null,
                "fact_check_suggestions": null,
                "fact_check_results": null,
                "grounding_metadata": null,
                "language_diagnostics": null,
                "summary": null,
                "error": "Article extraction sidecar is unavailable"
            })
        );
    }

    #[tokio::test]
    async fn jobs_image_routes_keep_default_providers_explicitly_unavailable() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let start = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/jobs/refresh")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(start.status(), StatusCode::OK);
        let start_body = to_bytes(start.into_body(), 16_384).await.expect("body");
        let start_body: serde_json::Value = serde_json::from_slice(&start_body).expect("JSON body");
        assert_eq!(start_body["status"], "error");
        let job_id = start_body["job_id"].as_str().expect("job id");

        let status = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/jobs/{job_id}/status"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(status.status(), StatusCode::OK);
        let status_body = to_bytes(status.into_body(), 16_384).await.expect("body");
        let status_body: serde_json::Value =
            serde_json::from_slice(&status_body).expect("JSON body");
        assert_eq!(status_body["status"], "error");
        assert_eq!(status_body["error"], "Refresh job worker is not available");

        let stream = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/jobs/{job_id}/stream"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(stream.status(), StatusCode::OK);
        assert_eq!(stream.headers()["content-type"], "text/event-stream");

        let proxy = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/image/proxy?url=https%3A%2F%2Fexample.org%2Fimage.png")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(proxy.status(), StatusCode::SERVICE_UNAVAILABLE);
        let proxy_body = to_bytes(proxy.into_body(), 16_384).await.expect("body");
        let proxy_body: serde_json::Value = serde_json::from_slice(&proxy_body).expect("JSON body");
        assert_eq!(proxy_body["detail"], "Image transport is not available");

        let stats = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/image/cache/stats")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(stats.status(), StatusCode::OK);

        let clear = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/image/cache/clear")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(clear.status(), StatusCode::OK);

        let og = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/image/og?url=https%3A%2F%2Fexample.org%2Farticle")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(og.status(), StatusCode::SERVICE_UNAVAILABLE);
        let og_body = to_bytes(og.into_body(), 16_384).await.expect("body");
        let og_body: serde_json::Value = serde_json::from_slice(&og_body).expect("JSON body");
        assert_eq!(
            og_body["detail"],
            "OpenGraph image provider is not available"
        );
    }
    #[tokio::test]
    async fn cache_stream_routes_keep_missing_providers_explicit() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app = router(database);

        let refresh = app
            .clone()
            .oneshot(
                Request::post("/cache/refresh")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("cache refresh response");
        assert_eq!(refresh.status(), StatusCode::OK);
        let refresh_body = to_bytes(refresh.into_body(), 16_384)
            .await
            .expect("cache refresh body");
        let refresh_body: serde_json::Value =
            serde_json::from_slice(&refresh_body).expect("cache refresh JSON");
        assert_eq!(refresh_body["status"], "error");
        assert_eq!(
            refresh_body["message"],
            "Cache refresh provider is not available"
        );

        let refresh_stream = app
            .clone()
            .oneshot(
                Request::post("/cache/refresh/stream")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("cache refresh stream response");
        assert_eq!(refresh_stream.status(), StatusCode::OK);
        assert_eq!(
            refresh_stream.headers()["content-type"],
            "text/event-stream"
        );
        let refresh_stream = to_bytes(refresh_stream.into_body(), 16_384)
            .await
            .expect("cache refresh stream body");
        let refresh_stream =
            String::from_utf8(refresh_stream.to_vec()).expect("cache refresh stream UTF-8");
        assert!(refresh_stream.contains("Cache refresh provider is not available"));

        let news_stream = app
            .clone()
            .oneshot(
                Request::get("/news/stream?use_cache=false")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("news stream response");
        assert_eq!(news_stream.status(), StatusCode::OK);
        assert_eq!(news_stream.headers()["content-type"], "text/event-stream");
        let news_stream = to_bytes(news_stream.into_body(), 16_384)
            .await
            .expect("news stream body");
        let news_stream = String::from_utf8(news_stream.to_vec()).expect("news stream UTF-8");
        assert!(news_stream.contains("News live stream provider is not available"));

        let cache_status = app
            .clone()
            .oneshot(
                Request::get("/cache/status")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("cache status response");
        assert_eq!(cache_status.status(), StatusCode::OK);
        let cache_status = to_bytes(cache_status.into_body(), 16_384)
            .await
            .expect("cache status body");
        let cache_status: serde_json::Value =
            serde_json::from_slice(&cache_status).expect("cache status JSON");
        assert_eq!(cache_status["total_articles"], 0);
        assert_eq!(cache_status["update_in_progress"], false);

        let updates_stream = app
            .clone()
            .oneshot(
                Request::get("/updates/stream")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("updates stream response");
        assert_eq!(updates_stream.status(), StatusCode::OK);
        assert_eq!(
            updates_stream.headers()["content-type"],
            "text/event-stream"
        );
        let mut updates_chunks = updates_stream.into_body().into_data_stream();
        let connection_chunk =
            tokio::time::timeout(std::time::Duration::from_secs(1), updates_chunks.next())
                .await
                .expect("updates connection first chunk deadline")
                .expect("updates connection first chunk")
                .expect("updates connection first chunk body");
        let connection_chunk =
            String::from_utf8(connection_chunk.to_vec()).expect("updates connection UTF-8");
        assert!(connection_chunk.contains("\"type\":\"connected\""));
        drop(updates_chunks);

        let updates_status = app
            .oneshot(
                Request::get("/updates/status")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("updates status response");
        assert_eq!(updates_status.status(), StatusCode::OK);
        let updates_status = to_bytes(updates_status.into_body(), 16_384)
            .await
            .expect("updates status body");
        let updates_status: serde_json::Value =
            serde_json::from_slice(&updates_status).expect("updates status JSON");
        assert_eq!(updates_status["active_subscribers"], 0);
        assert_eq!(updates_status["total_events_sent"], 0);
    }

    #[tokio::test]
    async fn cache_stream_router_uses_injected_local_state() {
        let state = cache_stream::CacheStreamState::new();
        state.replace_cache(cache_stream::CacheSnapshot::new(
            vec![serde_json::json!({
                "category": "World",
                "title": "Supplied article"
            })],
            vec![serde_json::json!({
                "name": "Wire",
                "status": "success",
                "article_count": 1
            })],
            0.0,
            "2026-09-24T00:00:00+00:00",
        ));
        assert_eq!(
            state.publish_update("invalidate", Some(serde_json::json!({"reason": "sidecar"}))),
            Ok(1)
        );

        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let app =
            router_with_sidecars(database, RouterSidecars::default().with_cache_stream(state));

        let cache_status = app
            .clone()
            .oneshot(
                Request::get("/cache/status")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("cache status response");
        let cache_status = to_bytes(cache_status.into_body(), 16_384)
            .await
            .expect("cache status body");
        let cache_status: serde_json::Value =
            serde_json::from_slice(&cache_status).expect("cache status JSON");
        assert_eq!(cache_status["total_articles"], 1);

        let news_stream = app
            .clone()
            .oneshot(
                Request::get("/news/stream")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("news stream response");
        let news_stream = to_bytes(news_stream.into_body(), 16_384)
            .await
            .expect("news stream body");
        let news_stream = String::from_utf8(news_stream.to_vec()).expect("news stream UTF-8");
        assert!(news_stream.contains("Supplied article"));

        let updates_stream = app
            .clone()
            .oneshot(
                Request::get("/updates/stream")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("updates stream response");
        let mut updates_chunks = updates_stream.into_body().into_data_stream();
        let connection_chunk =
            tokio::time::timeout(std::time::Duration::from_secs(1), updates_chunks.next())
                .await
                .expect("updates connection first chunk deadline")
                .expect("updates connection first chunk")
                .expect("updates connection first chunk body");
        let connection_chunk =
            String::from_utf8(connection_chunk.to_vec()).expect("updates connection UTF-8");
        assert!(connection_chunk.contains("\"type\":\"connected\""));
        let update_chunk =
            tokio::time::timeout(std::time::Duration::from_secs(1), updates_chunks.next())
                .await
                .expect("updates event chunk deadline")
                .expect("updates event chunk")
                .expect("updates event chunk body");
        let update_chunk = String::from_utf8(update_chunk.to_vec()).expect("updates event UTF-8");
        assert!(update_chunk.contains("\"reason\":\"sidecar\""));
        drop(updates_chunks);

        let updates_status = app
            .oneshot(
                Request::get("/updates/status")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("updates status response");
        let updates_status = to_bytes(updates_status.into_body(), 16_384)
            .await
            .expect("updates status body");
        let updates_status: serde_json::Value =
            serde_json::from_slice(&updates_status).expect("updates status JSON");
        assert_eq!(updates_status["total_events_sent"], 1);
    }

    #[tokio::test]
    async fn invalid_json_fields_keep_the_fastapi_422_response_status() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router(database)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wiki/evidence/claims/evaluate")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"claim_id":"claim-1","complete_control_path":null}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), 16_384).await.expect("body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["detail"][0]["loc"][1], "complete_control_path");
        assert_eq!(body["detail"][0]["type"], "bool_type");
    }

    #[tokio::test]
    async fn evidence_policy_route_returns_explicit_policy_flags() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router(database)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/wiki/evidence/policies")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 65_536).await.expect("body");
        let policies: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        let rows = policies.as_array().expect("policy array");
        assert!(rows.iter().all(|row| {
            row.get("requires_complete_path").is_some() && row.get("permits_catalog_only").is_some()
        }));
        let control = rows
            .iter()
            .find(|row| row["predicate"] == "ultimate_control")
            .expect("ultimate_control policy");
        assert_eq!(control["minimum_independent_roots"], 1);
        assert_eq!(control["requires_complete_path"], true);
        assert_eq!(control["permits_catalog_only"], false);
    }

    #[tokio::test]
    async fn ranked_articles_route_preserves_article_shape_and_priority_order() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router(database)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/news/ranked")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "articles":[
                                {"id":1,"title":"Climate policy update","summary":"New climate policy details","category":"World","source":"Example Wire","source_id":"wire","tags":["climate"],"image":"https://example.org/article.jpg"},
                                {"id":2,"title":"Climate policy debate","summary":"Policy debate details","category":"World","source":"Example Wire","source_id":"wire","tags":["policy"],"image":"none"},
                                {"id":3,"title":"Climate policy response","summary":"Response details","category":"World","source":"Other Outlet","source_id":"other","tags":["response"],"image":"https://example.org/response.jpg"},
                                {"title":"Missing id is retained"}
                            ],
                            "liked_article_ids":[1],
                            "favorite_source_ids":["wire"]
                        }"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 16_384).await.expect("body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(body["total"], 4);
        assert_eq!(body["articles"][0]["id"], 1);
        assert_eq!(body["articles"][0]["ranking"]["bucket_rank"], 3);
        assert_eq!(body["articles"][1]["id"], 2);
        assert_eq!(body["articles"][1]["ranking"]["bucket_rank"], 2);
        assert_eq!(body["articles"][2]["id"], 3);
        assert_eq!(body["articles"][3]["title"], "Missing id is retained");
        assert!(body["articles"][3].get("ranking").is_none());
    }
}
