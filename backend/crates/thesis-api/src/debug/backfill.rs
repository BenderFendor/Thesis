use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;
use thesis_db::{ImageBackfillUpdate, MentionedCountryUpdate};
use utoipa::IntoParams;

use super::{
    parse_integer_query, provider_failed, provider_unavailable, query_validation_response,
    DebugProviderError, DebugState, MissingImageArticle,
};

pub(super) fn router(state: DebugState) -> Router {
    Router::new()
        .route("/debug/backfill/images", post(backfill_article_images))
        .route(
            "/debug/backfill/mentioned-countries",
            post(backfill_article_mentions),
        )
        .with_state(state)
}

#[derive(Clone, Debug, IntoParams)]
struct ImageBackfillQuery {
    #[param(minimum = 10, maximum = 500, example = 100)]
    batch_size: Option<i64>,
    #[param(minimum = 1)]
    max_batches: Option<i64>,
}

#[utoipa::path(
    post,
    path = "/debug/backfill/images",
    operation_id = "backfill_article_images_debug_backfill_images_post",
    tag = "debug",
    params(ImageBackfillQuery),
    responses(
        (status = 200, description = "Image backfill completed", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 503, description = "Database or image provider unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn backfill_article_images(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let batch_size = match parse_integer_query(&params, "batch_size", 100, 10, 500) {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    let max_batches = match parse_optional_max_batches(&params) {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    if !state.config.enable_database {
        return provider_unavailable("Database unavailable");
    }
    let Some(provider) = state.providers.image_backfill.as_ref() else {
        return provider_unavailable("Image backfill provider is not available");
    };

    let sources = match state.database.image_backfill_sources().await {
        Ok(sources) => sources,
        Err(error) => {
            tracing::error!(%error, "failed to find articles missing images");
            return database_failed();
        }
    };
    let mut total_processed = 0u64;
    let mut total_found = 0u64;
    let mut total_updated = 0u64;
    let mut batches = 0u64;
    let mut skipped = 0u64;
    for source in sources {
        if max_batches.is_some_and(|maximum| batches >= maximum as u64) {
            break;
        }
        loop {
            if max_batches.is_some_and(|maximum| batches >= maximum as u64) {
                break;
            }
            let articles = match state
                .database
                .image_backfill_batch(&source.source, batch_size)
                .await
            {
                Ok(articles) => articles,
                Err(error) => {
                    tracing::error!(%error, source = %source.source, "failed to read image backfill batch");
                    return database_failed();
                }
            };
            if articles.is_empty() {
                break;
            }
            let fetched = match provider
                .fetch_batch(
                    articles
                        .iter()
                        .map(|article| MissingImageArticle {
                            id: article.id,
                            url: article.url.clone(),
                        })
                        .collect(),
                )
                .await
            {
                Ok(fetched) => fetched,
                Err(error) => {
                    return provider_failed(error, "Image backfill provider is not available")
                }
            };
            let mut updates = Vec::with_capacity(articles.len());
            let mut cached_images = BTreeMap::new();
            let mut found_in_batch = 0u64;
            for article in &articles {
                let Some(image_url) = fetched.image_by_article_id.get(&article.id) else {
                    return provider_failed(
                        DebugProviderError::Failed(format!(
                            "image provider omitted article {}",
                            article.id
                        )),
                        "Image backfill provider is not available",
                    );
                };
                let image_url = image_url
                    .as_deref()
                    .filter(|image_url| !image_url.is_empty());
                if let Some(image_url) = image_url {
                    found_in_batch += 1;
                    cached_images.insert(article.id, image_url.to_owned());
                    updates.push(ImageBackfillUpdate {
                        id: article.id,
                        image_url: image_url.to_owned(),
                    });
                } else {
                    updates.push(ImageBackfillUpdate {
                        id: article.id,
                        image_url: "none".to_owned(),
                    });
                }
            }
            let updated_rows = match state.database.persist_image_backfill_batch(&updates).await {
                Ok(updated_rows) => updated_rows,
                Err(error) => {
                    tracing::error!(%error, "failed to persist image backfill batch");
                    return database_failed();
                }
            };
            if let Err(error) = provider.update_cached_images(&cached_images) {
                return provider_failed(error, "Image cache update is not available");
            }
            total_processed = total_processed.saturating_add(articles.len() as u64);
            total_found = total_found.saturating_add(found_in_batch);
            total_updated = total_updated.saturating_add(found_in_batch);
            skipped = skipped.saturating_add(articles.len() as u64 - found_in_batch);
            batches = batches.saturating_add(1);
            if updated_rows != articles.len() as u64 {
                tracing::warn!(
                    updated_rows,
                    requested_rows = articles.len(),
                    "image backfill changed a different number of rows than selected"
                );
            }
        }
    }
    Json(json!({
        "message": "Image backfill completed",
        "total_processed": total_processed,
        "total_found": total_found,
        "total_updated": total_updated,
        "batches": batches,
        "skipped": skipped
    }))
    .into_response()
}

#[derive(Clone, Debug, IntoParams)]
struct MentionedCountryBackfillQuery {
    #[param(minimum = 10, maximum = 2000, example = 500)]
    batch_size: Option<i64>,
    #[param(minimum = 1)]
    max_batches: Option<i64>,
}

#[utoipa::path(
    post,
    path = "/debug/backfill/mentioned-countries",
    operation_id = "backfill_article_mentions_debug_backfill_mentioned_countries_post",
    tag = "debug",
    params(MentionedCountryBackfillQuery),
    responses(
        (status = 200, description = "Mentioned-country backfill completed", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 503, description = "Database or country matcher unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn backfill_article_mentions(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let batch_size = match parse_integer_query(&params, "batch_size", 500, 10, 2000) {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    let max_batches = match parse_optional_max_batches(&params) {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    if !state.config.enable_database {
        return provider_unavailable("Database unavailable");
    }
    let Some(aliases) = state.providers.country_aliases.as_ref() else {
        return provider_unavailable("Country mention matcher is not available");
    };

    let mut processed = 0u64;
    let mut updated = 0u64;
    let mut batches = 0u64;
    let mut after_id = None;
    while max_batches.is_none_or(|maximum| batches < maximum as u64) {
        let articles = match state
            .database
            .mentioned_country_backfill_batch(after_id, batch_size)
            .await
        {
            Ok(articles) => articles,
            Err(error) => {
                tracing::error!(%error, "failed to read mentioned-country backfill batch");
                return database_failed();
            }
        };
        if articles.is_empty() {
            break;
        }
        let updates = articles
            .iter()
            .map(|article| MentionedCountryUpdate {
                id: article.id,
                countries: aliases.extract_article(
                    Some(&article.title),
                    article.summary.as_deref(),
                    article.content.as_deref(),
                ),
            })
            .collect::<Vec<_>>();
        if let Err(error) = state
            .database
            .persist_mentioned_country_batch(&updates)
            .await
        {
            tracing::error!(%error, "failed to persist mentioned-country batch");
            return database_failed();
        }
        after_id = articles.last().map(|article| article.id);
        processed = processed.saturating_add(articles.len() as u64);
        updated = updated.saturating_add(updates.len() as u64);
        batches = batches.saturating_add(1);
    }
    let remaining = match state.database.count_missing_mentioned_countries().await {
        Ok(remaining) => remaining,
        Err(error) => {
            tracing::error!(%error, "failed to count missing mentioned countries");
            return database_failed();
        }
    };
    Json(json!({
        "message": "Mentioned-country backfill completed",
        "processed": processed,
        "updated": updated,
        "batches": batches,
        "remaining": remaining
    }))
    .into_response()
}

fn parse_optional_max_batches(
    params: &HashMap<String, String>,
) -> Result<Option<i64>, crate::models::HttpValidationError> {
    if !params.contains_key("max_batches") {
        return Ok(None);
    }
    parse_integer_query(params, "max_batches", 1, 1, i64::MAX).map(Some)
}

fn database_failed() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": "Database request failed"})),
    )
        .into_response()
}
